const express = require('express');
const multer  = require('multer')
const fs = require('fs');
const bases = require('bases')
const rand = require('random-seed').create();
const sharp = require('sharp');
const app = express();
const path = require('path');
const heicConvert = require('heic-convert');

const jpegType = 'image/jpeg';
const heicType = 'image/heic';

//
// Utilities
//

function fail(res, error)
{
    res.writeHead(500, {'Content-Type': 'text/plain'});
    res.end(error);
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
                    fail(res, 'fs.readFile() error: ' + err);
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
                    fail(res, 'exception: ' + error);
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
    destination: function (req, file, cb)
    {
        var dir;
        if (file.mimetype === jpegType) { dir = 'images'; }
        else { dir = 'originals'; }
        cb(null, dir) 
    },
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
var upload = multer(multerOpts)

app.post('/api/upload', upload.array('files'), async function (req, res)
{
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
        fail(res, 'gallery read error: ' + err);
        return;
    }

    // Add the images to the gallery
    const thumbSize = 200;
    for (const file of req.files)
    {
        // Convert the image if necessary
        const originalFileName = file.filename;
        var fileName = originalFileName;
        if (file.mimetype !== jpegType)
        {
            // heic files come through with octet-stream mimetype for some reason, id them by extension instead
            if (path.extname(originalFileName).toLowerCase() === ".heic")
            {
                try
                {
                    const heic = fs.readFileSync('originals/' + originalFileName);
                    const converted = await heicConvert({buffer: heic, format: 'JPEG', quality: 1});
                    fileName = makeKey() + '.jpg';
                    fs.writeFileSync('images/' + fileName, converted);
                }
                catch (err)
                {
                    fail(res, 'heic convert error: ' + err.toString());
                    return;
                }
            }
            else
            {
                // Can't convert the file
                // TODO: need to report failures to the client
                fs.unlinkSync(originalFileName);
            }
        }
        
        // Create the thumbnail
        const thumbFileName = makeKey() + '.jpg';
        sharp('images/' + fileName)
        .resize({ width: thumbSize, height: thumbSize, fit: sharp.fit.outside })
        .resize({ width: thumbSize, height: thumbSize, fit: sharp.fit.cover })
        .toFile('thumbs/' + thumbFileName);
        
        gallery.images.push(
            {
                title: file.originalname,
                file: fileName,
                thumb: thumbFileName,
                original: originalFileName
            }
        );
    }
    
    // Write back the updated gallery
    try
    {
        fs.writeFileSync(galleryPath, JSON.stringify(gallery));
    }
    catch (err)
    {
        fail(res, 'gallery write error: ' + err);
        return;
    }

    res.send('uploaded ' + req.files.length + ' images');
});

app.post('/api/bar', function (req, res) {
    res.send('Hello from bar! node version ' + process.version);
});

app.listen(process.env.PORT);