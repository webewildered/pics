var express = require('express');
var multer  = require('multer')
var fs = require('fs');
var bases = require('bases')
var rand = require('random-seed').create();
const sharp = require('sharp');
var app = express();

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
                    if (adminJson.type == "admin")
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
        cb(null, 'images')
    },
    filename: function (req, file, cb)
    {
        cb(null, makeKey() + '.jpg');
    },
});
var multerOpts = {
    storage: multerStorage,
    fileFilter: function (req, file, cb)
    {
        cb(null, file.mimetype === "image/jpeg");
    }
};
var upload = multer(multerOpts)

app.post('/api/upload', upload.array('files'), function (req, res)
{
    // Read the gallery file to validate the key
    const galleryPath = 'galleries/' + req.body.galleryKey + '.json';
    fs.readFile(galleryPath, (err, data) =>
    {
        if (err)
        {
            fail(res, 'fs.readFile() error: ' + err);
            return;
        }
        
        try
        {
            // Add the images to the gallery
            var gallery = JSON.parse(data);
            const thumbSize = 200;
            for (const file of req.files)
            {
                const thumb = makeKey() + '.jpg';
                sharp(file.path)
                    .resize({ width: thumbSize, height: thumbSize, fit: sharp.fit.outside })
                    .resize({ width: thumbSize, height: thumbSize, fit: sharp.fit.cover })
                    .toFile('thumbs/' + thumb);
                
                gallery.images.push(
                    {
                        name: file.originalname,
                        file: file.filename,
                        thumb: thumb
                    }
                );
            }
            
            // Write back the updated gallery
            fs.writeFile(galleryPath, JSON.stringify(gallery), () =>
            {
                res.send('uploaded ' + req.files.length + ' images');
            });
        }
        catch (error)
        {
            fail(res, 'exception: ' + error);
            return;
        }
    });
});

app.post('/api/bar', function (req, res) {
    res.send('Hello from bar! node version ' + process.version);
});

app.listen(process.env.PORT);