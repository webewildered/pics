const express = require('express');
const multer  = require('multer')
const fs = require('fs');
const bases = require('bases')
const rand = require('random-seed').create();
const sharp = require('sharp');
const app = express();
const path = require('path');
const heicConvert = require('heic-convert');

//
// Utilities
//

function getFileType(file, fileName)
{
    // Try to discern the type from known bytes at the beginning of the file.
    // The given mimetype is not reliable, and I have seen files with the .heic extension that are actually jpegs.
    const signatures =
    [
        {'type': 'jpeg', 'header': Buffer.from([0xFF, 0xD8, 0xFF, 0xDB]), 'offset': 0 },
        {'type': 'jpeg', 'header': Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), 'offset': 0 },
        {'type': 'jpeg', 'header': Buffer.from([0xFF, 0xD8, 0xFF, 0xEE]), 'offset': 0 },
        {'type': 'jpeg', 'header': Buffer.from([0xFF, 0xD8, 0xFF, 0xE1]), 'offset': 0 },
        {'type': 'heic', 'header': Buffer.from([0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]), 'offset': 4 },
    ];
    for (const signature of signatures)
    {
        if (signature.header.compare(file, signature.offset, signature.offset + signature.header.length) == 0)
        {
            return signature.type;
        }
    }

    // Temp: if the signature is unknown, report it for debugging. Remove this code later and fall back to the extension.
    var sig = '';
    for (i = 0; i < 16; i++)
    {
        sig = sig + ('0' + file[i].toString(16)).slice(-2) + ', ';
    }
    throw new Error('Unknown signature [' + sig + '] = "' + file.toString('ascii', 0, 16) + "'" );

    // If that fails, try the extension
    const ext = path.extname(fileName).toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg')
    {
        return 'jpeg';
    }
    if (ext === ".heic")
    {
        return 'heic';
    }

    // Unknown
    return null;
}

function makeKey ()
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

//
// Create a photo gallery
//

app.post('/api/createGallery', function (req, res)
{
    const fail = (error) =>
    {
        res.writeHead(500, {'Content-Type': 'text/plain'});
        res.end(error);
    }

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
                    fail('fs.readFile() error: ' + err);
                    return;
                }

                try
                {
                    adminJson = JSON.parse(data);
                    if (adminJson.type === 'admin')
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
                            fs.writeFile(adminPath, JSON.stringify(adminJson), () =>
                            {
                                // Return the gallery key to the client
                                res.writeHead(200, {'Content-Type': 'text/plain'});
                                res.end(galleryKey);
                            });
                        });
                    }
                }
                catch (error)
                {
                    fail('exception: ' + error.stack);
                    return;
                }
            });
        });
    }
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
    res.writeHead(200, {'Content-Type': 'application/json'});
    const fail = (error) =>
    {
        res.end(JSON.stringify({'error': error}));
    }

    // Read the gallery file to validate the key
    const galleryPath = 'galleries/' + req.body.galleryKey + '.json';
    var gallery;
    try
    {
        const data = fs.readFileSync(galleryPath);
        gallery = JSON.parse(data);
    }
    catch (err)
    {
        fail('gallery read error: ' + err.stack);
        return;
    }

    // Check the file's type. Filename extension and mimetype are both unreliable.
    const file = req.file;
    var originalFileName = file.filename;
    var fileName = file.filename;
    try
    {
        const image = fs.readFileSync('originals/' + originalFileName);
        const type = getFileType(image, fileName);
        if (type === 'jpeg')
        {
            // Move the file to the images directory. We don't need to convert it so we don't need to keep a separate original around.
            fileName = path.parse(fileName).name + '.jpg';
            fs.renameSync('originals/' + originalFileName, 'images/' + fileName);
            originalFileName = '';
        }
        else if (type === 'heic')
        {
            // Convert the heic to a jpeg
            const converted = await heicConvert({buffer: image, format: 'JPEG', quality: 1});
            fileName = makeKey() + '.jpg';
            fs.writeFileSync('images/' + fileName, converted);
        }
        else
        {
            fail('Unknown file type');
            fs.unlinkSync('originals/' + originalFileName);
            return;
        }
    }
    catch (err)
    {
        fail('file error: ' + err.stack);
        return;
    }
    
    // Create the thumbnail
    const thumbSize = 200;
    const thumbFileName = makeKey() + '.jpg';
    await sharp('images/' + fileName)
    .resize({ width: thumbSize, height: thumbSize, fit: sharp.fit.outside })
    .resize({ width: thumbSize, height: thumbSize, fit: sharp.fit.cover })
    .toFile('thumbs/' + thumbFileName);

    // Update the gallery
    const galleryEntry = 
    {
        title: file.originalname,
        file: fileName,
        thumb: thumbFileName,
        original: originalFileName
    };
    gallery.images.push(galleryEntry);

    // Send the new gallery entry to the client
    res.write(JSON.stringify(galleryEntry));
    
    // Write back the updated gallery
    try
    {
        fs.writeFileSync(galleryPath, JSON.stringify(gallery));
    }
    catch (err)
    {
        fail('gallery write error: ' + err.stack);
        return;
    }

    res.end();
});

app.post('/api/bar', function (req, res) {
    res.send('Hello from bar! node version ' + process.version);
});

app.listen(process.env.PORT);