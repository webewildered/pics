const express = require('express');
const multer = require('multer')
const fs = require('fs');
const bases = require('bases')
const rand = require('random-seed').create();
const sharp = require('sharp');
const app = express();
const path = require('path');
const heicConvert = require('heic-jpg-exif');//require('heic-convert');
const getExif = require('exif-async');
const ffmpeg = require('fluent-ffmpeg');

//
// Utilities
//

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

// Verifies that the request body is json with a valid adminKey, and if so calls op(json, res, adminJson, adminPath)
function adminOp(req, res, op)
{
    try
    {
        const { headers } = req;
        if (headers['content-type'] == 'application/json')
        {
            // Read the request data into body
            let body = [];
            req.on('data', (chunk) =>
            {
                body.push(chunk);
            }).on('end', () =>
            {
                body = Buffer.concat(body).toString();

                // Read the admin file to validate the key
                const requestJson = JSON.parse(body);
                const adminKey = requestJson.adminKey;
                const adminPath = 'admin/' + adminKey + '.json';
                fs.readFile(adminPath, (err, data) =>
                {
                    if (err)
                    {
                        throw err;
                    }

                    adminJson = JSON.parse(data);
                    if (adminJson.type === 'admin')
                    {
                        op(requestJson, res, adminJson, adminPath);
                    }
                });
            });
        }
    }
    catch (err)
    {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(error);
    }
}

//
// Create a photo gallery
//

app.post('/api/createGallery', function (req, res)
{
    adminOp(req, res, (requestJson, res, adminJson, adminPath) =>
    {
        // Create the gallery
        const galleryKey = makeKey();
        let gallery = {};
        gallery.name = requestJson.name;
        gallery.images = [];
        fs.writeFile('galleries/' + galleryKey + '.json', JSON.stringify(gallery), () =>
        {
            // Add the gallery to the list
            adminJson.galleries.push(galleryKey);
            fs.writeFile(adminPath, JSON.stringify(adminJson), (err) =>
            {
                if (err)
                {
                    throw err;
                }

                // Return the gallery key to the client
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end(galleryKey);
            });
        });
    });
});

//
// Delete a photo gallery
//

app.post('/api/deleteGallery', function (req, res)
{
    adminOp(req, res, (requestJson, res, adminJson, adminPath) =>
    {
        // Delete the gallery
        const galleryKey = requestJson.galleryKey;
        const galleryPath = 'galleries/' + galleryKey + '.json';
        fs.readFile(galleryPath, (err, data) =>
        {
            if (err)
            {
                throw err;
            }

            fs.unlink(galleryPath, (err) =>
            {
                if (err)
                {
                    throw err;
                }

                // Remove the gallery from the list
                const index = adminJson.galleries.indexOf(galleryKey);
                if (index < 0)
                {
                    fail('gallery was not in the admin list');
                    return;
                }
                adminJson.galleries.splice(index, 1);
                fs.writeFile(adminPath, JSON.stringify(adminJson), (err) =>
                {
                    if (err)
                    {
                        throw err;
                    }

                    // Return the gallery key to the client
                    res.writeHead(200, { 'Content-Type': 'text/plain' });
                    res.end(galleryKey);
                });
            });
        });
    });
});

//
// Upload photos
//

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
app.post('/api/upload', upload.single('image'), async function (req, res)
{
    let cleanup = []; // List of files to delete in case of failure
    try
    {
        sharp.cache(false); // Otherwise it keeps files open which prevents deletion of temporaries

        // Read the gallery file to validate the key
        const galleryPath = 'galleries/' + req.body.galleryKey + '.json';
        const data = fs.readFileSync(galleryPath);
        let gallery = JSON.parse(data);

        // Check the file's type. Filename extension and mimetype are both unreliable.
        // TODO we should probably be able to do this without reading the entire file. I don't think it matters for images where we're
        // going to load the whole thing anyway, but it probably does matter for video, which can be huge and which will be processed
        // by ffmpeg rather than js code.
        const file = req.file;
        const originalFileName = req.file.filename;
        const originalPath = 'originals/' + originalFileName;
        cleanup.push(originalPath);
        const uploadedImage = fs.readFileSync(originalPath);
        const type = getFileType(uploadedImage, originalFileName);

        var galleryEntry;
        if (type === 'jpeg' || type === 'heic')
        {
            galleryEntry = processImage(req.file, type);
        }
        else if (type === 'mp4' || type === 'qt')
        {
            let fileName = originalFileName;

            const metadata = await new Promise((resolve, reject) =>
            {
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
            });
            let foundVideo = false;
            let foundUnsupportedCodec = false;
            let width = 0;
            let height = 0;
            let duration = 0;
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
            let location = 'Unknown location';
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
                    location = await reverseGeocode(location); // TODO don't await, paralellize with video processing
                }
            }

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

            if (foundUnsupportedCodec)
            {
                // Transcode
                fileName = makeKey() + '.mp4';
                const newPath = 'images/' + fileName;
                cleanup.push(newPath);
                await ffpromise(ffmpeg(originalPath).output(newPath), (video) => video.run());
            }
            else
            {
                // Move the original
                fileName = path.parse(fileName).name + '.mp4'; // TODO can we get a non-mp4 with the supported codec?
                fs.renameSync(originalPath, 'images/' + fileName); // TODO this could probably be async
            }

            // Capture a thumbnail (note, it doesn't seem possible to do this with the transcode in a single command)
            const tempThumbFileName = makeKey() + '.jpg';
            const tempThumbPath  = 'thumbs/' + tempThumbFileName;
            await ffpromise(ffmpeg(originalPath), (video) => 
            {
                video.screenshots({filename: tempThumbFileName, folder: 'thumbs', timestamps: [Math.min(1, duration / 2)]})
            });

            // Size the thumbnail
            const sharpImage = sharp(tempThumbPath);
            const thumbFileName = makeKey() + '.jpg';
            await createThumb(sharpImage, 'thumbs/' + thumbFileName);
            fs.unlinkSync(tempThumbPath);

            // Create the gallery entry
            galleryEntry = {
                title: file.originalname,
                file: fileName,
                thumb: thumbFileName,
                original: originalFileName,
                width: width,
                height: height,
                date: date,
                location: location
            };
        }
        else
        {
            throw new Error('Unknown file type "' + type + '"');
        }
        gallery.images.push(galleryEntry);

        // Write back the updated gallery
        fs.writeFileSync(galleryPath, JSON.stringify(gallery));

        // Send the new gallery entry to the client
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(galleryEntry));
    }
    catch (err)
    {
        try
        {
            for (const path of cleanup)
            {
                fs.unlinkSync(path);
            }
        } catch {}
        if (!res.writableEnded)
        {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end(err.stack);
        }
    }
});

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
    const req = 'https://nominatim.openstreetmap.org/reverse?lat=' + lat + '&lon=' + lon + '&format=geocodejson';
    return fetch(req, { method: 'GET', headers: { 'accept-language': 'en-us' } })
        .then((res) => res.json())
        .then((json) =>
        {
            let location = lat + ', ' + lon; // Show GPS coordinates in case of failure
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

async function processImage(file, type)
{
    var originalFileName = file.filename;
    var fileName = file.filename;
    var jpegImage;
    if (type === 'jpeg')
    {
        // Move the file to the images directory. We don't need to convert it so we don't need to keep a separate original around.
        fileName = path.parse(fileName).name + '.jpg';
        fs.renameSync('originals/' + originalFileName, 'images/' + fileName); // TODO this could probably be async
        originalFileName = '';
        jpegImage = uploadedImage;
    }
    else if (type === 'heic')
    {
        // Convert the heic to a jpeg
        // const converted = await heicConvert({buffer: image, format: 'JPEG', quality: 1});
        // fileName = makeKey() + '.jpg';
        // fs.writeFileSync('images/' + fileName, converted);
        const converted = await heicConvert(uploadedImage);
        fileName = makeKey() + '.jpg';
        fs.writeFileSync('images/' + fileName, converted);
        jpegImage = converted;
    }
    else
    {
        throw new error('Unexpected image type "' + type + '"');
    }

    // We start multiple async operations, then await them all
    let promises = [];

    // Create the thumbnail
    const sharpImage = sharp(jpegImage);
    const thumbFileName = makeKey() + '.jpg';
    promises.push(createThumb(sharpImage, thumbFileName));

    // Get native image dimensions
    let nativeWidth, nativeHeight;
    promises.push(sharpImage
        .metadata()
        .then((metadata) =>
        {
            nativeWidth = metadata.width;
            nativeHeight = metadata.height;
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
        }, (err) => { throw new Error('Exif error: ' + err.message); })
        .then((reverseGeocodeResult) => { location = reverseGeocodeResult; })
    );

    await Promise.all(promises);
    if (res.writableEnded)
    {
        return;
    }

    // Create the gallery entry
    return {
        title: file.originalname,
        file: fileName,
        thumb: thumbFileName,
        original: originalFileName,
        width: nativeWidth,
        height: nativeHeight,
        date: originalDate,
        location: location
    };
}

app.post('/api/bar', function (req, res)
{
    res.send('Hello from bar! node version ' + process.version);
});

app.listen(process.env.PORT);