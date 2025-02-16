const express = require('express');
const multer = require('multer')
const fs = require('fs').promises;
const bases = require('bases')
const rand = require('random-seed').create();
const sharp = require('sharp');
sharp.cache(false); // Otherwise it keeps files open which prevents deletion of temporaries
const app = express();
const path = require('path');
const getExif = require('exif-async');
const ffmpeg = require('fluent-ffmpeg');
const { fork } = require('node:child_process');
const process = require('node:process');

//
// Utilities
//

// Detects the type of the file. file:Buffer, fileName:String
function getFileType(file, fileName)
{
    // Try to discern the type from known bytes at the beginning of the file.
    // The given mimetype is not reliable, and I have seen files with the .heic extension that are actually jpegs.
    const signatures =
        [
            { 'type': 'jpeg', 'header': Buffer.from([0xFF, 0xD8, 0xFF, 0xDB]), 'offset': 0 },
            { 'type': 'jpeg', 'header': Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), 'offset': 0 },
            { 'type': 'jpeg', 'header': Buffer.from([0xFF, 0xD8, 0xFF, 0xEE]), 'offset': 0 },
            { 'type': 'jpeg', 'header': Buffer.from([0xFF, 0xD8, 0xFF, 0xE1]), 'offset': 0 },
            { 'type': 'heic', 'header': Buffer.from([0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]), 'offset': 4 },
            { 'type': 'mp4', 'header': Buffer.from([0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6F, 0x6D]), 'offset': 4 },
            { 'type': 'mp4', 'header': Buffer.from([0x66, 0x74, 0x79, 0x70, 0x4D, 0x53, 0x4E, 0x56]), 'offset': 4 },
            { 'type': 'qt', 'header': Buffer.from([0x66, 0x74, 0x79, 0x70, 0x71, 0x74]), 'offset': 4 }, // ftypqt
        ];
    for (const signature of signatures)
    {
        if (signature.header.compare(file, signature.offset, signature.offset + signature.header.length) == 0)
        {
            return signature.type;
        }
    }

    // TODO: if the signature is unknown, report it for debugging. Remove this code later and fall back to the extension.
    var sig = '';
    for (i = 0; i < 16; i++)
    {
        sig = sig + ('0' + file[i].toString(16)).slice(-2) + ', ';
    }
    throw new Error('Unknown signature [' + sig + '] = "' + file.toString('ascii', 0, 16) + "'");

    // If that fails, try the extension
    const ext = path.extname(fileName).toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg')
    {
        return 'jpeg';
    }
    if (ext === '.heic')
    {
        return 'heic';
    }
    if (ext === '.mp4')
    {
        return 'mp4';
    }
    if (ext === '.mov')
    {
        return 'qt';
    }

    // Unknown
    return null;
}

// Generates a random key string
function makeKey()
{
    const minValue = bases.fromBase36('00000');
    const maxValue = bases.fromBase36('zzzzz');

    let key = '';
    for (let i = 0; i < 4; i++)
    {
        let subKey = bases.toBase36(rand.intBetween(minValue, maxValue));
        while (subKey.length < 5)
        {
            subKey = '0' + subKey;
        }
        key = subKey + key;
    }

    return key;
}

// Reads an Express Request and parses it as JSON. Returns a promise that resolves to the parsed object.
function readRequest(req)
{
    return new Promise((resolve, reject) =>
    {
        // Read the request data into body
        let body = [];
        req
            .on('data', (chunk) =>
            {
                body.push(chunk);
            })
            .on('end', () =>
            {
                body = Buffer.concat(body).toString();
                resolve(JSON.parse(body));
            })
            .on('error', () => reject('Request error'))
            .on('error', () => reject('Request closed'))
            .on('error', () => reject('Request aborted'));
    });
}

// Sends an Express Response with an error message, from either a String or an Error.
function handleError(res, err)
{
    err = (err instanceof Error) ? err.stack : err;
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(err);
}

// Verifies that the request body is json with a valid adminKey, and if so calls op(requestJson, adminJson).
// op() returns a promise resolving to the response to write in case of success.
// Modifications that op() makes to adminJson are written back atomically.
// Returns a Promise.
function adminOp(req, res, op)
{
    readRequest(req)
        .then(requestJson =>
        {
            // Read the admin file (this validates the key)
            const adminKey = requestJson.adminKey;
            const adminPath = 'admin/' + adminKey + '.json';
            return updateJsonAtomic(adminPath, (adminJson) => op(requestJson, adminJson))
        })
        .then(opResult =>
        {
            // Return the keys to the client
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(opResult));
        })
        .catch(err => handleError(res, err));
}

// Locks a file. Returns a promise that resolves when the lock is acquired to a handle which can be passed to unlock().
function lock(file, attempts = 20, delay = 10, backoff = 2, maxDelay = 1000)
{
    const lockFile = file + '.lock';
    return new Promise((resolve, reject) =>
    {
        function tryLock()
        {
            fs.writeFile(lockFile, 'lock', {flag: 'wx'})
                .then((fh) => resolve(lockFile))
                .catch((err) =>
                {
                    if (!(--attempts > 0))
                    {
                        reject('Could not lock ' + file);
                        return;
                    }
                    setTimeout(tryLock, delay);
                    delay *= backoff;
                    delay = Math.min(delay, maxDelay);
                });
        }
        tryLock();
    });
}

// Unlocks a file. Takes the handle returned from lock(). Returns a promise that resolves when the lock is released.
function unlock(lockFile)
{
    if (lockFile !== undefined)
    {
        return fs.unlink(lockFile);
    } // else the lock was not held
}

// Atomically read-modify-write json file. The object in the file is passed to update, which can modify it. Returns a promise
// that resolves to the return value of update.
function updateJsonAtomic(path, update)
{
    let handle;
    let updateResult;
    let json;
    return lock(path)
        .then((handleIn) =>
        {
            handle = handleIn;
            return fs.readFile(path, 'utf8');
        })
        .then((jsonStr) =>
        {
            json = JSON.parse(jsonStr);
            return update(json);
        })
        .then((updateResultIn) =>
        {
            updateResult = updateResultIn;
            return fs.writeFile(path, JSON.stringify(json));
        })
        .then(() =>
        {
            return updateResult
        })
        .finally(() => unlock(handle));
}

// Converts a heic image to a jpg. Source and dest both paths. Forks a child process to do the conversion. Returns a promise
// that resolves when the conversion completes / rejects if it fails.
function heic2jpg(source, dest)
{
    return new Promise((resolve, reject) =>
    {
        const child = fork('heic2jpg.js', [source, dest], { stdio: ['inherit', 'inherit', 'pipe', 'ipc'] });
        let err = '';
        child.stderr.on('data', (data) => { err += data; });
        child.on('close', (code) =>
        {
            if (code === 0)
            {
                resolve();
            }
            else
            {
                reject(err)
            }
        })
    });
}

// Testing helper, returns a promise that resolves after t ms.
function pause(t)
{
    return new Promise((resolve, reject) =>
    {
        setTimeout(() => resolve(), t);
    })
}

app.post('/api/clear', function (req, res)
{
    adminOp(req, res, (requestJson, adminJson) =>
    {
        function clearDirectory(directory) {
            return fs.stat(directory)
            .then((dirExists) => {
                if (!dirExists)
                {
                    throw new Error('Missing directory ' + directory);
                }
                return fs.readdir(directory);
            })
            .then((files) => {
                return Promise.all(files.map((file) => {
                    const filePath = path.join(directory, file);
                    return fs.unlink(filePath);
                }));
            })
            .catch((error) => console.error(`Error deleting files: ${error.message}`));
        }

        return Promise.all([
            clearDirectory('images'),
            clearDirectory('originals'),
            clearDirectory('thumbs'),
            clearDirectory('galleries')
        ])
        .then(() =>
        {
            adminJson.galleries = [];
            return {}; // Return empty result to the user
        });
    });
});

app.post('/api/test', function (req, res)
{
    const result = {abc:123};
    adminOp(req, res, () => result);
    // let handle;
    // let json;
    // readRequest(req)
    //     .then((jsonIn) =>
    //     {
    //         json = jsonIn; 
    //         return lock('zzz.txt');
    //     })
    //     .then((handleIn) =>
    //     {
    //         handle = handleIn;
    //         return fs.writeFile('zzz.txt', 'write ' + json.message);
    //     })
    //     .then(() =>
    //     {
    //         res.writeHead(200, { 'Content-Type': 'application/json' });
    //         res.end(JSON.stringify({ok:'ok'}));
    //     })
    //     .then(() => pause(500))
    //     .catch((err) => handleError(res, err))
    //     .finally(() => unlock(handle));
});

//
// Create a photo gallery
//

app.post('/api/createGallery', function (req, res)
{
    adminOp(req, res, (requestJson, adminJson) =>
    {
        const promises = [];

        // Create the gallery
        const writeKey = makeKey();
        const galleryKey = makeKey();
        let gallery = {};
        gallery.name = requestJson.name;
        gallery.images = [];
        promises.push(fs.writeFile('galleries/' + galleryKey + '.json', JSON.stringify(gallery)));
        
        // Add the write permission file
        const writePath = 'galleries/' + writeKey + '.json';
        promises.push(fs.writeFile(writePath, JSON.stringify({galleryKey: galleryKey})));
        
        // Add the gallery to the list
        const galleryKeys = {galleryKey: galleryKey, writeKey: writeKey};
        adminJson.galleries.push(galleryKeys);

        // Return the gallery keys to the client
        return Promise.all(promises).then(() => galleryKeys);
    });
});

//
// Delete a photo gallery
//

app.post('/api/deleteGallery', function (req, res)
{
    adminOp(req, res, (requestJson, adminJson) =>
    {
        const promises = [];
        const galleryKey = requestJson.galleryKey;
                
        // Remove the entry from the admin file
        let writeKey;
        for (let index = 0; index < adminJson.galleries.length; index++)
        {
            const galleryKeys = adminJson.galleries[index];
            if (galleryKeys.galleryKey === galleryKey)
            {
                writeKey = galleryKeys.writeKey;
                adminJson.galleries.splice(index, 1);
                break;
            }
        }
        if (writeKey === undefined)
        {
            throw new Error('gallery ' + galleryKey + ' was not in the admin list');
        }

        // Delete the gallery file
        const galleryPath = 'galleries/' + galleryKey + '.json';
        promises.push(fs.unlink(galleryPath));

        // Delete the write key file
        const keyPath = 'galleries/' + writeKey + '.json';
        promises.push(fs.unlink(keyPath));

        let result = {galleryKey: galleryKey};
        return Promise.all(promises).then(() => result);
    });
});

//
// Upload photos
//

function timems()
{
    const hrTime = process.hrtime.bigint()
    return Number(hrTime / 1000n) / 1000 // ns -> ms
}

var multerStorage = multer.diskStorage(
    {
        destination: function (req, file, cb) { cb(null, 'originals') },
        filename: function (req, file, cb)
        {
            var ext = path.extname(file.originalname).substring(1);
            cb(null, makeKey() + '.' + ext);
        },
    });
var multerOpts = {
    storage: multerStorage,
    fileFilter: function (req, file, cb)
    {
        cb(null, true);
    }
};
var upload = multer(multerOpts);
app.post('/api/upload', upload.single('image'), function (req, res)
{
    let lastTime = timems();
    function logTime(label)
    {
        // let time = timems();
        // let dt = time - lastTime;
        // lastTime = time;
        // console.log(label + ': ' + dt);
    }

    let cleanup = []; // List of files to delete in case of failure
    let galleryKey;
    
    const file = req.file;
    let originalFileName = file.filename;
    const originalPath = 'originals/' + originalFileName;
    cleanup.push(originalPath);

    // Validate the write key and get the gallery key
    const keyPath = 'galleries/' + req.body.writeKey + '.json';
    fs.readFile(keyPath)
        .then((keyFile) =>
        {
            galleryKey = JSON.parse(keyFile).galleryKey;

            // Read the image file
            return fs.readFile(originalPath);
        })
        .then((uploadedData) =>
        {
            // Check the file's type. Filename extension and mimetype are both unreliable.
            // TODO we should probably be able to do this without reading the entire file. I don't think it matters for images where we're
            // going to load the whole thing anyway, but it probably does matter for video, which can be huge and which will be processed
            // by ffmpeg rather than js code.
            const type = getFileType(uploadedData, originalFileName);
            
            if (type === 'jpeg' || type === 'heic')
            {
                logTime('uploadImage ' + originalFileName);
                return processImage(uploadedData, type, originalFileName);
            }
            else if (type === 'mp4' || type === 'qt')
            {
                return processVideo(uploadedData, originalFileName);
            }
            else
            {
                throw new Error('Unknown file type "' + type + '"');
            }
        })
        .then((galleryEntry) =>
        {
            // Update the gallery
            galleryEntry.title = file.originalname;
            galleryEntry.hash = req.body.hash;
            const galleryPath = 'galleries/' + galleryKey + '.json';
            return updateJsonAtomic(galleryPath, (gallery) =>
            {
                gallery.images.push(galleryEntry);
            })
            .then(() =>
            {
                // Send the new gallery entry to the client
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(galleryEntry));
            })
        })
        .catch((err) =>
        {
            handleError(res, err);

            // TODO - the process*() functions need to add things to cleanup, and also remove (e.g. if they rename an original)
            for (const path of cleanup)
            {
                fs.unlink(path);
            }
        })
});

function processImage(image, imageType, originalFileName)
{
    let lastTime = timems();
    function logTime(label)
    {
        // let time = timems();
        // let dt = time - lastTime;
        // lastTime = time;
        // console.log(label + ': ' + dt);
    }

    const originalPath = 'originals/' + originalFileName;
    let fileName = originalFileName;
    let convertPromise;
    if (imageType === 'jpeg')
    {
        // Move the file to the images directory. We don't need to convert it so we don't need to keep a separate original around.
        fileName = path.parse(fileName).name + '.jpg';
        originalFileName = '';
        convertPromise = fs.rename(originalPath, 'images/' + fileName)
            .then(() => image);
    }
    else if (imageType === 'heic')
    {
        // Convert the heic to a jpeg
        fileName = makeKey() + '.jpg';
        const jpgPath = 'images/' + fileName;
        convertPromise = heic2jpg(originalPath, jpgPath)
            .then(() => fs.readFile(jpgPath));
    }
    else
    {
        throw new error('Unexpected image type "' + imageType + '"');
    }

    return convertPromise.then((jpegImage) =>
    {
        logTime('convert ' + originalFileName)
        const promises = [];

        // Create the thumbnail
        const sharpImage = sharp(jpegImage).rotate();
        const thumbFileName = makeKey() + '.jpg';
        promises.push(createThumb(sharpImage.clone(), 'thumbs/' + thumbFileName));
    
        // Get native image dimensions
        let nativeWidth, nativeHeight;
        promises.push(sharpImage
            .metadata()
            .then((metadata) =>
            {
                if (metadata.orientation && metadata.orientation <= 4)
                {
                    nativeWidth = metadata.width;
                    nativeHeight = metadata.height;
                }
                else
                {
                    nativeWidth = metadata.height;
                    nativeHeight = metadata.width;
                }
            })
        );
    
        // Extract exif data
        let originalDate = new Date(1900, 0);
        let location = 'Unknown location';
        promises.push(getExif(jpegImage)
            .then((exifData) =>
            {
                // Extract date and time from exif, should be YYYY:MM:DD HH:MM:SS
                var dateTime = exifData.exif.DateTimeOriginal;
                const dateTimeMatches = dateTime.match(/(\d\d\d\d):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/);
                if (dateTimeMatches)
                {
                    originalDate = new Date();
                    originalDate.setFullYear(Number(dateTimeMatches[1]));
                    originalDate.setMonth(Number(dateTimeMatches[2]));
                    originalDate.setDate(Number(dateTimeMatches[3]));
                    originalDate.setHours(Number(dateTimeMatches[4]));
                    originalDate.setMinutes(Number(dateTimeMatches[5]));
                    originalDate.setSeconds(Number(dateTimeMatches[6]));
                }
    
                // Extract GPS coordinates from exif, should be degrees,minutes,seconds
                function exifGPSCoordToDeg(exifGPSCoord)
                {
                    if (exifGPSCoord && exifGPSCoord.length == 3)
                    {
                        const degrees = exifGPSCoord[0];
                        const minutes = exifGPSCoord[1];
                        const seconds = exifGPSCoord[2];
                        return degrees + minutes / 60 + seconds / 3600;
                    }
                    return 0;
                }
    
                const lat = exifGPSCoordToDeg(exifData.gps.GPSLatitude);
                const lon = exifGPSCoordToDeg(exifData.gps.GPSLongitude);
    
                return reverseGeocode(lat, lon);
            })
            .then((reverseGeocodeResult) => { location = reverseGeocodeResult; })
        );
    
        // Return the gallery entry
        return Promise.all(promises).then(() =>
        {
            logTime('process ' + originalFileName)
            return {
                file: fileName,
                thumb: thumbFileName,
                original: originalFileName,
                width: nativeWidth,
                height: nativeHeight,
                date: originalDate,
                location: location
            };
        });
    });
}

function processVideo(video, originalFileName)
{
    const originalPath = 'originals/' + originalFileName;
    return new Promise((resolve, reject) =>
    {
        // Read metadata
        
        ffmpeg(originalPath).ffprobe((err, data) =>
        {
            if (err)
            {
                reject(err);
            }
            else
            {
                resolve(data);
            }
        });
    })
    .then((metadata) =>
    {
        const promises = [];

        // Process metadata
        let foundVideo = false;
        let foundUnsupportedCodec = false;
        let width = 0;
        let height = 0;
        let duration = 0;
        let location = 'Unknown location';
        for (const stream of metadata.streams)
        {
            if (stream.codec_type === 'video')
            {
                foundVideo = true;
                width = stream.width;
                height = stream.height;
                duration = Number(stream.duration);
                if (stream.codec_tag_string !== 'avc1')
                {
                    foundUnsupportedCodec = true;
                }
                break; // TODO not sure what a file with multiple video streams would mean
            }
        }
    
        if (!foundVideo)
        {
            throw new Error('Video stream not found');
        }
    
        // Extract date from the metadata
        var date = new Date(1900, 1);
        if (metadata.creation_time)
        {
            date = new Date(metadata.creation_time);
        }
    
        // Extract location from the metadata
        let coords = metadata.location;
        if (!coords)
        {
            coords = metadata['com.apple.quicktime.location.ISO6709'];
        }
        if (coords)
        {
            const regex = /^([-+]\d{2,3}\.\d+)([-+]\d{2,3}\.\d+).+$/;
            const match = iso6709.match(regex);
            if (match)
            {
                const latitude = parseFloat(match[1]);
                const longitude = parseFloat(match[2]);
                promises.push(reverseGeocode(location)
                    .then((reverseGeocodeResult) => { location = reverseGeocodeResult; }));
            }
        }

        // Process video
        function ffpromise(video, cb)
        {
            return new Promise((resolve, reject) =>
            {
                let cl = '';
                video
                    .on('start', (clStart) => { cl = clStart; })
                    .on('error', (err, stdout, stderr) =>
                    {
                        let message = err.message + cl;
                        reject(new Error(message));
                    })
                    .on('end', (result) => resolve(result));
                cb(video);
            });
        }

        let fileName = originalFileName;
        if (foundUnsupportedCodec)
        {
            // Transcode
            fileName = makeKey() + '.mp4';
            const newPath = 'images/' + fileName;
            //cleanup.push(newPath); // TODO
            promises.push(ffpromise(ffmpeg(originalPath).output(newPath), (video) => video.run()));
        }
        else
        {
            // Move the original
            fileName = path.parse(fileName).name + '.mp4'; // TODO can we get a non-mp4 with the supported codec?
            promises.push(fs.rename(originalPath, 'images/' + fileName));
        }

        // Capture a thumbnail (note, it doesn't seem possible to do this with the transcode in a single command)
        const tempThumbFileName = makeKey() + '.jpg';
        const tempThumbPath  = 'thumbs/' + tempThumbFileName;
        let thumbFileName;
        promises.push(
            ffpromise(ffmpeg(originalPath), (video) => 
            {
                video.screenshots({filename: tempThumbFileName, folder: 'thumbs', timestamps: [Math.min(1, duration / 2)]})
            })
            .then(() =>
            {
                // Size the thumbnail and delete the temporary file
                const sharpImage = sharp(tempThumbPath);
                thumbFileName = makeKey() + '.jpg';
                return createThumb(sharpImage, 'thumbs/' + thumbFileName).then(() => fs.unlink(tempThumbPath));
            }));

    
        // Return the gallery entry
        return Promise.all(promises).then(() =>
        {
            return {
                file: fileName,
                thumb: thumbFileName,
                original: originalFileName,
                width: width,
                height: height,
                date: date,
                location: location
            };
        });
    });
}

function createThumb(sharpImage, thumbFileName)
{
    // TODO what if an image is smaller than the thumbnail size?
    const thumbSize = 200;
    return sharpImage
        .resize({ width: thumbSize, height: thumbSize, fit: sharp.fit.outside })
        .resize({ width: thumbSize, height: thumbSize, fit: sharp.fit.cover })
        .toFile(thumbFileName);
}

// Returns a promise resolving to a location name string
function reverseGeocode(latitude, longitude)
{
    // Reverse geocode to get place name, see https://nominatim.org/release-docs/latest/api/Reverse/
    // TODO we should have a language setting. Alternatively we can do the reverse geocode in the client, but
    // then there is a delay before the location appears.
    const req = 'https://nominatim.openstreetmap.org/reverse?lat=' + latitude + '&lon=' + longitude + '&format=geocodejson';
    return fetch(req, { method: 'GET', headers: { 'accept-language': 'en-us' } })
        .then((res) => res.json())
        .then((json) =>
        {
            let location = latitude + ', ' + longitude; // Show GPS coordinates in case of failure
            if (typeof json.features !== 'undefined' &&
                Array.isArray(json.features) &&
                json.features.length >= 1 &&
                typeof json.features[0].properties !== 'undefined' &&
                typeof json.features[0].properties.geocoding !== 'undefined')
            {
                const geocoding = json.features[0].properties.geocoding;

                // Fields to extract from the address, in order of preference
                function getAddrPart(partPreferences)
                {
                    for (const part of partPreferences)
                    {
                        if (typeof geocoding[part] !== 'undefined')
                        {
                            return geocoding[part];
                        }
                    }
                    return null;
                }
                const location1 = getAddrPart(['district', 'locality', 'postcode']);
                const location2 = getAddrPart(['city', 'state', 'country']);
                if (location1 || location2)
                {
                    if (location1 && location2)
                    {
                        location = location1 + ', ' + location2;
                    }
                    else if (location1)
                    {
                        location = location1;
                    }
                    else
                    {
                        location = location2;
                    }
                }
            }
            return location;
        })
        .catch((err) =>
        {
            // TODO we shouldn't really fail the upload if reverse geocode didn't work. It would be better to just
            // mark the entry as having a problem and have a means to retry the lookup later
            throw new Error('Location error: ' + err.message);
        })
}

app.post('/api/deleteImage', function (req, res)
{
    readRequest(req)
        .then(requestObject =>
        {
            // Validate the write key and get the gallery key
            const keyPath = 'galleries/' + requestObject.writeKey + '.json';
            return fs.readFile(keyPath)
                .then((keyFile) =>
                    {
                        galleryKey = JSON.parse(keyFile).galleryKey;
                        const galleryPath = 'galleries/' + galleryKey + '.json';
                        return updateJsonAtomic(galleryPath, gallery =>
                        {
                            for (let i = 0; i < gallery.images.length; i++)
                            {
                                if (gallery.images[i].file === requestObject.file)
                                {
                                    gallery.images.splice(i, 1);
                                    return;
                                }
                            }
                        })
                    });
        })
        .then(() =>
        {
            // Return an empty object to ack the deletion
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({}));
        })
        .catch(err => handleError(res, err));
});

app.post('/api/bar', function (req, res)
{
    res.send('Hello from bar! node version ' + process.version);
});

app.listen(process.env.PORT);