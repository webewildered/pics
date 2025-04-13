import Feeler from './feeler.js';
import Album from './album.js';
import * as thumbsView from './thumbs.js';
import * as imageView from './image.js';
import * as fade from './fade.js'
import { sha256 } from './sha256.js'; // note, crypto.subtle requires https

const album = new Album();

//
// Read parameters
//

const params = new URLSearchParams(window.location.search);

// If there is no mouse, then hide mouse controls
var hasMouse = true;
const mouseSetting = params.get('mouse');
if (mouseSetting && (mouseSetting.toLowerCase() === 'true' || mouseSetting === '1'))
{
    hasMouse = true
}
else if (mouseSetting && (mouseSetting.toLowerCase() === 'false' || mouseSetting === '0'))
{
    hasMouse = false;
}
else
{
    const matchMedia = window.matchMedia || window.msMatchMedia;
    if (matchMedia)
    {
        hasMouse = matchMedia("(pointer:fine)").matches;
    }
}

// Get the album key and use it to load the album
var albumKey;
for (const key of params.keys())
{
    const val = params.get(key);
    if (val === '')
    {
        albumKey = key;
        break;
    }
}

window.onload = () =>
{
    // Init modules
    thumbsView.init(album, hasMouse);
    thumbsView.addEventListener('click', (event) =>
    {
        let thumbIndex = event.index;
        imageView.show(thumbIndex);
        thumbsView.setFocus(false);
    });

    imageView.init(album, hasMouse);
    imageView.addEventListener('close', () =>
    {
        thumbsView.setFocus(true);
    });

    // Set a fixed scale. Zoom doesn't work and this prevents responsive displays from auto-scaling to fit content that should be outside of the viewport.
    const scale = Math.min(window.screen.width / 981, 1.0);
    const viewport = document.querySelector('meta[name="viewport"]');
    viewport.setAttribute('content', `width=device-width, initial-scale=${scale}, maximum-scale=${scale}, user-scalable=no`);

    // Load the album
    album.load(albumKey)
    .then(() =>
    {
        if (album.collectionKey)
        {
            $('#albumBar').removeAttr('hidden');
        }
    })
    .catch((err) =>
    {
        console.log('Error loading album: ' + err);
    });
    
    // Handle input events
    Feeler.tap($('#uploadButton').get(0), upload);
    
    // Forward taps on the browse button to its click handler. Don't override the click handler itself.
    Feeler.tap($('#fileInput').get(0), () => { $('#fileInput').click(); }, false);

    // Disable touch on elements that don't otherwise have touch control.
    // This prevents accidentally changing the browser zoom while pinch zooming an image.
    const disableTouch = (jqElem) => jqElem.each((idx, elem) => Feeler.disable(elem));
    disableTouch($('#albumBar'));
    disableTouch($('.imageBar'));

    // Animate
    tLast = window.performance.now();
    requestAnimationFrame(animate);
}

function upload(event)
{
    // Collect the set of hashes in the album
    let hashes = new Set();
    for (const object of album.objects)
    {
        hashes.add(objects.hash);
    }

    event.preventDefault();
    const files = document.getElementById('fileInput');
    const filesTotal = files.files.length;
    let filesComplete = 0;
    let filesSkipped = 0;
    let filesFailed = 0;
    function updateProgress()
    {
        if (filesComplete === filesTotal)
        {
            $('#progressContainer').attr('hidden', true);
            $('#progressText').attr('hidden', true);
        }
        else
        {
            $('#progressContainer').removeAttr('hidden');
            $('#progressBar').css('width', Math.floor(100 * filesComplete / filesTotal) + '%');
            $('#progressText').removeAttr('hidden')
                .text(filesComplete + '/' + filesTotal);
        }
        if (filesSkipped === 0)
        {
            $('#skippedText').attr('hidden', true);
        }
        else
        {
            $('#skippedText').removeAttr('hidden').text(filesSkipped + ' skipped');
        }
        if (filesFailed === 0)
        {
            $('#errorText').attr('hidden', true);
        }
        else
        {
            $('#errorText').removeAttr('hidden').text(filesFailed + ' uploads failed!');
        }
    }

    // Browser limits the number of simultaneous requests to 6, if we queue up 50 upload requests then
    // we won't be able to load the uploaded images until 45 of them complete. For now rate-limit the
    // requests, later we should probably stream uploads over a single websocket
    let nextFileIndex = 0;
    function nextRequest()
    {
        if (nextFileIndex >= filesTotal)
        {
            return;
        }

        const file = files.files[nextFileIndex++];

        // Hash the file
        file.arrayBuffer()
            .then(buffer => 
            {
                // If a file with the same hash is in the album, skip the upload
                const hash = sha256(buffer);
                if (hashes.has(hash))
                {
                    filesSkipped++;
                    return;
                }

                // Upload the file
                const formData = new FormData();
                formData.append('collectionKey', album.collectionKey);
                formData.append('image', file);
                formData.append('hash', hash);
                return fetch('api/upload', { method: 'POST', body: formData })
                    .then((response) =>
                        {
                            if (response.status !== 200)
                            {
                                return response.text().then((text) =>
                                {
                                    const err = response.status + ' ' + response.statusText + '\n' + response.url + '\n' + text;
                                    throw new Error(err);
                                });
                            }
                            else
                            {
                                return response.json().then((object) =>
                                {
                                    console.log('Added ' + object.title);
                                    album.add(object);
                                });
                            }
                        });
            })
            .catch((err) =>
            {
                console.log('Upload "' + file.name + '" failed: ' + err.stack + '\n' + err.toString());
                filesFailed++;
            })
            .finally(() =>
            {
                filesComplete++;
                updateProgress();
                nextRequest();
            });
    }
    const maxSimultaneousRequests = 4;
    for (let i = 0; i < maxSimultaneousRequests; i++)
    {
        nextRequest();
    }

    // Show the progress bar
    updateProgress();
}

//
// Main loop
//

var tLast;
function animate(t)
{
    // Calculate time since the last animate() call
    const dt = (t - tLast) * 1e-3;
    tLast = t;
    
    // Update UI elements
    thumbsView.update(dt);
    imageView.update(dt);
    fade.update(dt);

    // Animate forever
    requestAnimationFrame(animate);
}