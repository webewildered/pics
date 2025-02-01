import Point from './point.js';
import Scroll from './scroll.js';
import Feeler from './feeler.js';

//
// Global parameters
//

var galleryKey;
var writeKey;
var gallery;
var hasMouse = true;

//
// GUI mode
//

const galleryMode = "galleryMode";
const imageMode = "imageMode";
var focus = galleryMode;

//
// Thumbnail gallery
//

const thumbRes = 200; // Native size of thumbnail images in px
const thumbMargin = 2; // Horizontal space between thumbnails in px
var thumbPitch = 0; // Number of thumbnails per row
var thumbSize = 0; // Displayed thumbnail size
var thumbSizeEnd = 0; // End thumbnail's width
var thumbScroll = new Scroll(); // Gallery vertical scroll

//
// Image viewer
//

const numNeighborImages = 1; // Number of image/video elements to each side of the active one.
const numTotalImages = numNeighborImages * 2 + 1;
var images = []; // List of image/video elements in order from left to right. Active one is in the middle of the array.
var zoomCenter = new Point(); // Point in image space to zoom about, relative to the center of the image
const maxZoom = Math.log(4);
var enableImageControls = true; // Whether to show the top and bottom bars over the image
var imagePressed = false; // true if the image has been clicked/touched and not yet released
var imageMouseOrigin = new Point(); // Location where the image press began
var imageScrollX = new Scroll(); // Image pan
var imageScrollY = new Scroll();
var imageScrollZ = new Scroll(); // Image zoom
imageScrollZ.boundStiffness = 0.8;
imageScrollZ.debug = true;
var imageScrollRangeExtension = new Point();

function styleImage(imageElement, isEnd)
{
    if (isEnd)
    {
        imageElement
            .attr('width', thumbSizeEnd)
            .attr('height', thumbSize)
            .attr('class', 'thumb-end');
    }
    else
    {
        imageElement
            .attr('width', thumbSize)
            .attr('height', thumbSize)
            .attr('class', 'thumb');
    }
    return imageElement;
}

function addImage(galleryEntry)
{
    const image = $('<img>')
        .attr('src', 'thumbs/' + galleryEntry.thumb)
        .attr('draggable', false)
        .addClass('noSelect')
        .appendTo(thumbs);
    image.get(0).galleryEntry = galleryEntry;
    image.on('click', () => clickThumb(galleryEntry));
    const isEnd = ($('#thumbs').children().length % thumbPitch) == 0;
    styleImage(image, isEnd);
}

function createImage(index)
{
    const galleryEntry = gallery.images[index];
    const sourcePath = 'images/' + galleryEntry.file;
    const isVideo = galleryEntry.file.endsWith('.mp4');
    let image;
    if (isVideo)
    {
        image = $('<video>');
        $('<source>').attr('src', sourcePath).appendTo(image);
    }
    else
    {
        image = $('<img>')
            .attr('src', sourcePath)
            .attr('draggable', false);
    }
    image
        .addClass('mainImage')
        .addClass('noSelect')
    image.appendTo('#imageView');

    // Attach the gallery entry to the image
    image.get(0).galleryIndex = index;
    return image;
}

function updateActiveImage()
{
    // Get the current active image
    const image = images[numNeighborImages];
    const galleryEntry = gallery.images[image.get(0).galleryIndex];

    // Update the metadata
    const date = new Date(galleryEntry.date);
    const format = new Intl.DateTimeFormat();
    format.dateStyle = 'full';
    $('#time').text(date.toLocaleString(format));
    $('#location').text(galleryEntry.location);

    // Play video
    if (image.prop('nodeName').toLowerCase() === 'video')
    {
        const video = image.get(0);
        video.play();
    }

    // Toggle nav button visibility
    (images[numNeighborImages - 1] == null || !hasMouse) ? $('#navButtonLeft').hide() : $('#navButtonLeft').show();
    (images[numNeighborImages + 1] == null || !hasMouse) ? $('#navButtonRight').hide() : $('#navButtonRight').show();

    // Reset zoom state
    imageScrollZ.reset(getMinZoom(image));
}

function clickThumb(galleryEntry)
{
    fade($('#imageView'), true, 0.1);

    // Create the images
    images = [];
    for (let i = -numNeighborImages; i <= numNeighborImages; i++)
    {
        const index = galleryEntry.index + i;
        if (index < 0 || index >= gallery.images.length)
        {
            images.push(null);
        }
        else
        {
            images.push(createImage(index));
        }
    }
    
    // Reset scroll state
    imageScrollX.reset();
    imageScrollY.reset();
    
    updateActiveImage();
    
    focus = imageMode;
    enableImageControls = true;
    showImageBar(true, true); // show image bar immediate
}

function clickBackButton()
{
    // Remove all images
    if (images.length)
    {
        for (const image of images)
        {
            if (image !== null)
            {
                image.remove();
            }
        }
        images = [];
        fade($('#imageView'), false, 0.1);
        focus = galleryMode;
    }
}

function onNav(direction)
{
    if (direction !== 1 && direction !== -1)
    {
        throw new Error('Invalid navigation direction ' + direction);
    }

    if (images[numNeighborImages + direction] === null)
    {
        // Already on the first or last image
        return;
    }

    // Create the new image
    const currentIndex = getActiveImage().get(0).galleryIndex;
    const newIndex = currentIndex + direction * (numNeighborImages + 1);
    let newImage = null;
    if (newIndex >= 0 && newIndex < gallery.images.length)
    {
        newImage = createImage(newIndex);
    }

    // Shift it into the array
    let oldImage;
    if (direction > 0)
    {
        // Remove at beginning, insert at end
        oldImage = images[0];
        images.splice(0, 1);
        images.push(newImage);
    }
    else
    {
        // Remove at end, insert at beginning
        oldImage = images.pop();
        images.splice(0, 0, newImage);
    }

    // Remove any old image shifted out of the array
    if (oldImage !== null)
    {
        oldImage.remove();
    }

    // Shift scroll
    imageScrollX.x += direction * getClientSize().x;

    // Display
    updateActiveImage();
}

function showImageBar(show, immediate)
{
    enableImageControls = show;
    fade($('.imageBar'), enableImageControls, immediate ? 0 : 0.1);
}

async function upload(event)
{
    event.preventDefault();

    const files = document.getElementById('fileInput');
    let count = 0;
    for (const file of files.files)
    {
        const formData = new FormData();
        formData.append('writeKey', writeKey);
        formData.append('image', file);
        fetch('api/upload', { method: 'POST', body: formData })
            .then((response) =>
            {
                if (response.status !== 200)
                {
                    return response.text().then((text) => { throw new Error(text); });
                }
                else
                {
                    return response.json().then((galleryEntry) =>
                    {
                        console.log('Added ' + galleryEntry.title);
                        galleryEntry.index = gallery.images.length;
                        gallery.images.push(galleryEntry);
                        addImage(galleryEntry);
                        count++;
                    });
                }
            })
            .catch((err) => console.log(err));
    }
    console.log('Uploaded ' + count + ' images');
}

function layout()
{
    var width = $('#thumbContainer').width();
    const newThumbPitch = Math.ceil((width + thumbMargin) / (thumbRes + thumbMargin));
    const newThumbSize = Math.ceil((width + thumbMargin) / newThumbPitch - thumbMargin);
    const newThumbSizeEnd = width - (newThumbPitch - 1) * (newThumbSize + thumbMargin);
    if (newThumbPitch !== thumbPitch || newThumbSize !== thumbSize || newThumbSizeEnd !== thumbSizeEnd)
    {
        thumbPitch = newThumbPitch;
        thumbSize = newThumbSize;
        thumbSizeEnd = newThumbSizeEnd;
        //console.log('width ' + width + ' pitch ' + thumbPitch + ' size ' + thumbSize);
        
        styleImage($('#thumbs').children(), false);
        styleImage($('#thumbs img:nth-child(' + thumbPitch + 'n)'), true);
    }
}
window.onresize = layout;

var hasMouse = true;
window.onload = () =>
{
    // Load parameters
    const params = new URLSearchParams(window.location.search);
    for (const key of params.keys())
    {
        const val = params.get(key);
        if (val === '')
        {
            galleryKey = key;
        }
    }

    // If there is no mouse, then hide mouse controls
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

    // Load the gallery
    const loadGallery = (galleryIn) =>
    {
        gallery = galleryIn;
        for (let i = 0; i < gallery.images.length; i++)
        {
            const galleryEntry = gallery.images[i];
            galleryEntry.index = i;
            addImage(galleryEntry);
        }
    }
    const loadGalleryJson = (key) =>
    {
        return fetch('galleries/' + key + '.json')
            .then((response) => response.json())
    }
    const thumbs = $('#thumbs');
    loadGalleryJson(galleryKey)
        .then((json) =>
        {
            if (json.galleryKey)
            {
                writeKey = galleryKey;
                galleryKey = json.galleryKey;
                loadGalleryJson(galleryKey)
                    .then((json) => { loadGallery(json) })
                    .catch((error) =>
                    {
                        $('<span style="color:white">error: ' + error + '</span>').appendTo(thumbs);
                    });
            }
            else
            {
                loadGallery(json);
            }
        })
        .catch((error) =>
        {
            $('<span>error: ' + error + '</span>').appendTo(thumbs);
        });
    layout();

    // Handle input events
    Feeler.tap($('#uploadButton').get(0), upload);
    Feeler.tap($('#backButton').get(0), clickBackButton);
    Feeler.tap($('#navButtonLeft').get(0), () => onNav(-1));
    Feeler.tap($('#navButtonRight').get(0), () => onNav(1));
    $('#imageClick').on('mousedown', onImageMousedown);
    $('#imageClick').on('mousemove', onImageMousemove);
    
    // Forward taps on the browse button to its click handler. Don't override the click handler itself.
    Feeler.tap($('#fileInput').get(0), () => { $('#fileInput').click(); }, false);

    // Disable touch on elements that don't otherwise have touch control.
    // This prevents accidentally changing the browser zoom while pinch zooming an image.
    const disableTouch = (jqElem) => jqElem.each((idx, elem) => Feeler.disable(elem));
    disableTouch($('#galleryBar'));
    disableTouch($('.imageBar'));

    // Thumbnail gallery touch scrolling
    const thumbFeeler = new Feeler($('#thumbContainer').get(0));
    thumbFeeler.addEventListener('start', (event) => 
    {
        if (event.touches.length)
        {
            event.reject();
        }
    });
    thumbFeeler.addEventListener('end', (event) =>
    {
        if (thumbScroll.touch)
        {
            thumbScroll.release();
        }
        else
        {
            const thumb = document.elementFromPoint(event.touches[0].pos.x, event.touches[0].pos.y);
            if (thumb.classList.contains('thumb') || thumb.classList.contains('thumb-end'))
            {
                clickThumb(thumb.galleryEntry)
            }
        }
    });
    thumbFeeler.addEventListener('move', (event) =>
    {
        if (thumbScroll.touch)
        {
            const touch = event.touches[0];
            thumbScroll.target -= touch.pos.y - touch.last.y;
        }
        else
        {
            // Ignore delta on the first move event. Something below us on the stack implements a deadzone, so we
            // see a big jump on the first move, which we want to skip.
            thumbScroll.grab();
        }
    });

    // Image touch control
    const imageFeeler = new Feeler($('#imageClick').get(0));
    imageFeeler.addEventListener('start', (event) => 
    {
        if (event.touches.length == 1)
        {
            // Seems to be no deadzone for multitouch - grab immediately
            if (!imageScrollX.touch)
            {
                startImagePan();
            }
            imageScrollZ.grab();
        }
        else if (event.touches.length == 2)
        {
            event.reject();
        }
    });
    imageFeeler.addEventListener('end', (event) =>
    {
        if (event.touches.length == 1)
        {
            if (imageScrollX.touch)
            {
                // Release pan
                endImagePan();
            }
            else
            {
                // Release tap
                showImageBar(!enableImageControls, false); // toggle image bar with fade
            }
        }
        else if (event.touches.length == 2)
        {
            imageScrollZ.release();
            imageScrollX.v = 0;
            imageScrollY.v = 0;
            imageScrollZ.v = 0; // no momentum
        }
    });
    imageFeeler.addEventListener('move', (event) =>
    {
        if (event.touches.length == 1)
        {
            if (imageScrollX.touch)
            {
                const touch = event.touches[0];
                moveImagePan(touch.pos.sub(touch.last));
            }
            else
            {
                startImagePan();
            }
        }
        else
        {
            const t0 = event.touches[0];
            const t1 = event.touches[1];
            const center = t0.pos.add(t1.pos).mul(0.5);
            const lastCenter = t0.last.add(t1.last).mul(0.5);
            const movement = center.sub(lastCenter);
            moveImagePan(movement);

            const scale = t0.pos.distance(t1.pos) / t0.last.distance(t1.last);
            imageScrollZ.target += Math.log(scale);
            setZoomCenter(center);
        }
    });

    // Animate
    tLast = window.performance.now();
    requestAnimationFrame(animate);
}

//
// Image pan input
//

function startImagePan()
{
    imageScrollX.grab();
    imageScrollY.grab();
}

function endImagePan()
{
    imageScrollX.release();
    imageScrollY.release();
}

function moveImagePan(delta)
{
    imageScrollX.target += delta.x;
    imageScrollY.target += delta.y;
}

//
// PC input handlers
//

function onImageMousedown(event)
{
    imagePressed = true;
    imageMouseOrigin = new Point(event.clientX, event.clientY);
}

function onImageMousemove(event)
{
    if (imagePressed)
    {
        let imageMousePos = new Point(event.clientX, event.clientY);
        let imageMouseDelta = imageMousePos.sub(imageMouseOrigin);
        if (!imageScrollX.touch)
        {
            const deadZone = 5; // Distance the mouse must move before beginning to drag the image
            const distSq = imageMouseDelta.lengthSquared();
            if (distSq > deadZone * deadZone)
            {
                startImagePan();
                imageMouseOrigin = imageMouseOrigin.add(imageMouseDelta.mul(deadZone / Math.sqrt(distSq))).round(); // Where the mouse exits the deadzone
                imageMouseDelta = imageMousePos.sub(imageMouseOrigin);
            }
        }
        if (imageScrollX.touch)
        {
            moveImagePan(imageMouseDelta);
            imageMouseOrigin = imageMousePos;
        }
    }
}

onmouseup = (event) =>
{
    if (imagePressed)
    {
        if (!imageScrollX.touch)
        {
            showImageBar(!enableImageControls, false); // toggle image bar with fade
        }
        imagePressed = false;
        imageScrollX.release();
        imageScrollY.release();
    }
}

onwheel = (event) =>
{
    let deltaPx = event.deltaY;
    switch (event.deltaMode)
    {
        case WheelEvent.DOM_DELTA_LINE: deltaPx *= 15; break;
        case WheelEvent.DOM_DELTA_PAGE: deltaPx *= 100; break;
    }
    switch (focus)
    {
        case galleryMode:
            thumbScroll.animate = true;
            thumbScroll.target += deltaPx;
            break;
        case imageMode:
            const zoomRate = 0.001;
            const oldZoomTarget = imageScrollZ.target;
            const minZoom = getMinZoom(getActiveImage());
            imageScrollZ.target = Math.max(minZoom, Math.min(maxZoom, oldZoomTarget - deltaPx * zoomRate));
            imageScrollZ.animate = true;
            if (imageScrollZ.target == minZoom && oldZoomTarget != minZoom)
            {
                $('.navButton').css({width:'30%'}); // Big navigation buttons
            }
            else if (oldZoomTarget == minZoom && imageScrollZ.target != minZoom)
            {
                showImageBar(false, false); // fade image bar out
                $('.navButton').css({width:'10%'}); // Small navigation buttons
            }

            // Find the mouse position in image space
            const imageOffset = getActiveImage().offset();
            setZoomCenter(new Point(event.clientX, event.clientY));
    }
}

//
// Main loop
//

// Utility for fading elements in and out
var fades = [];
function fade(elements, fadeIn, duration = 0)
{
    elements.each(function()
    {
        const element = $(this);
        for (let i = 0; i < fades.length; i++)
        {
            const fade = fades[i];
            if (fade.element.is(element))
            {
                if (duration == 0)
                {
                    // Fade will be executed immediately, remove the animation
                    fades.splice(i, 1);
                    break;
                }
                
                // Replace the animation
                let rate = 1 / duration;
                fade.rate = (fade.fadeIn == fadeIn) ? Math.max(rate, fade.rate) : rate;
                fade.fadeIn = fadeIn;
                return;
            }
        }

        if (duration == 0)
        {
            if (fadeIn)
            {
                element.css({opacity: 1}).show();
            }
            else
            {
                element.css({opacity: 0}).hide();
            }
            return;
        }

        let rate = 1 / duration;
        fades.push({
            element: element,
            fadeIn: fadeIn,
            rate: rate
        });
    });
}

function updateFades(dt)
{
    for (let i = 0; i < fades.length; i++)
    {
        const fade = fades[i];
        let opacity = Number(fade.element.css('opacity'));
        if (fade.fadeIn)
        {
            fade.element.show();
            opacity += fade.rate * dt;
            if (opacity >= 1)
            {
                opacity = 1;
                fades.splice(i--, 1);
            }
        }
        else
        {
            opacity -= fade.rate * dt;
            if (opacity <= 0)
            {
                opacity = 0;
                fade.element.hide();
                fades.splice(i--, 1);
            }
        }
        opacity = fade.element.css('opacity', opacity);
    }
}

// decay x by a factor of rate every second. Snap to 0 when abs(x) < limit.
function decay(x, dt, rate, limit = 0)
{
    if (Math.abs(x) < limit)
    {
        return 0;
    }
    const factor = Math.pow(rate, dt);
    return x * factor;
}

function updateThumbs(dt)
{
    const thumbs = $('#thumbs');
    const thumbContainer = $('#thumbContainer');

    // Calculate the scroll range
    const minScroll = 0;
    const contentHeight = thumbs.prop('scrollHeight');
    const panelHeight = thumbContainer.height();
    const maxScroll = Math.max(contentHeight - panelHeight, 0);

    // Animate scroll
    thumbScroll.update(dt, minScroll, maxScroll);
    thumbs.css({position: 'relative', top: -thumbScroll.x});
}

function getClientSize() { return new Point(window.innerWidth, window.innerHeight); }
function getGalleryEntry(image) { return gallery.images[image.get(0).galleryIndex]; }
function getActiveImage() { return images[numNeighborImages]; }
function getNativeSize(image)
{
    const entry = getGalleryEntry(image);
    return new Point(entry.width, entry.height);
}
function getZoomScale() { return Math.pow(Math.E, imageScrollZ.x); }
function getMinZoomScale(image)
{
    const scaleXY = getClientSize().div(getNativeSize(image));
    return Math.min(scaleXY.x, scaleXY.y, 1);
}
function getMinZoom(image) { return Math.log(getMinZoomScale(image)); }
function getScaledSize(image, zoomed)
{
    const nativeSize = getNativeSize(image);
    let scale = zoomed ? getZoomScale() : getMinZoomScale(image);
    return nativeSize.mul(scale);
}

function setZoomCenter(clientPos)
{
    const image = getActiveImage();
    const imageOffset = image.offset();
    const nativeSize = getNativeSize(image);
    zoomCenter = clientPos
        .sub(new Point(imageOffset.left, imageOffset.top)) // Relative to topleft corner
        .div(getZoomScale()) // In native scale
        .max(0).min(nativeSize) // Clamped to image
        .sub(nativeSize.div(2)); // Relative to image center
}

function updateImage(dt)
{
    if (images.length == 0)
    {
        return;
    }
    
    const image = getActiveImage();
    
    // Calculate the scroll range - the minimum necessary to be able to see the whole image by scrolling, plus any extra specified by
    // imageScrollRangeExtension (positive values extend max, negative values extend min)
    let scrollRange, scrollMin, scrollMax;
    function calcScrollRange()
    {
        const imageSize = getScaledSize(image, true);
        scrollRange = imageSize.sub(getClientSize()).max(0).div(2);
        scrollMax = scrollRange.add(imageScrollRangeExtension.max(0));
        scrollMin = scrollRange.neg().add(imageScrollRangeExtension.min(0));
    }

    // Calculate current excess of the scroll range
    calcScrollRange();
    const scroll = new Point(imageScrollX.x, imageScrollY.x);
    const overMax = scroll.sub(scrollMax).max(0);
    const underMin = scroll.sub(scrollMin).min(0);
    
    // Animate zoom
    const oldZoomScale = getZoomScale();
    const minZoom = getMinZoom(image);
    imageScrollZ.update(dt, minZoom, maxZoom);
    const zoomScale = getZoomScale();

    if (imageScrollZ.target <= minZoom && !imageScrollZ.touch)
    {
        // Reset scroll range extension and recenter
        imageScrollRangeExtension = new Point();
        scrollRange = new Point();
        scrollMin = new Point();
        scrollMax = new Point();
    }
    else
    {
        // Recalculate the scroll range at the new zoom
        calcScrollRange();

        // Shift the image position to maintain the position of the zoomCenter in screen space
        const zoomShift = zoomCenter.mul(oldZoomScale - zoomScale);
        const newScroll = scroll.add(zoomShift);
        const newOverMax = newScroll.sub(scrollMax).max(0);
        const newUnderMin = newScroll.sub(scrollMin).min(0);

        // Calculate whether the zoom shift pushes beyond the scroll range and by how much.
        // If it does, extend the range so that it does not push back from the shift.
        const newScrollRangeExtension = 
            newOverMax.sub(overMax).max(0)
            .add(newUnderMin.sub(underMin).min(0));
        imageScrollRangeExtension = imageScrollRangeExtension.binary(newScrollRangeExtension, (a, b) =>
        {
            if (Math.abs(b) < 1e-5)
            {
                return a; // Ignore tiny changes, can get b==0 or maybe an opposite-signed value from numerical error
            }
            return Math.sign(a) == Math.sign(b) ? a + b : b;
        });

        // If scrolled back towards the natural range, reduce the extension
        imageScrollRangeExtension = imageScrollRangeExtension
            .min(newScroll.sub(scrollRange).max(0))
            .max(newScroll.sub(scrollRange.neg()).min(0));

        // Apply the shift
        imageScrollX.x += zoomShift.x;
        imageScrollX.target += zoomShift.x;
        imageScrollY.x += zoomShift.y;
        imageScrollY.target += zoomShift.y;
        
        calcScrollRange(); // Recalculate the range
    }

    // Animate scroll
    imageScrollX.update(dt, scrollMin.x, scrollMax.x);
    imageScrollY.update(dt, scrollMin.y, scrollMax.y);

    const imageScroll = new Point(imageScrollX.x, imageScrollY.x);
    const neighborShift = new Point(getClientSize().x, 0);
    for (let i = 0; i < numTotalImages; i++)
    {
        const image = images[i];
        if (image === null)
        {
            continue;
        }
        const galleryEntry = gallery.images[image.get(0).galleryIndex];
        const offset = i - numNeighborImages;
        
        const scaledSize = getScaledSize(image, offset == 0);

        const position = getClientSize()
            .sub(scaledSize).div(2) // Center
            .add(imageScroll) // Apply scroll
            .add(neighborShift.mul(offset)); // Shift neighbor images by screen widths

        image.css(
        {
            'width': scaledSize.x,
            'height': scaledSize.y,
            'left': position.x,
            'top': position.y
        });
    }
}

var tLast;
function animate(t)
{
    // Calculate time since the last animate() call
    const dt = (t - tLast) * 1e-3;
    tLast = t;
    
    // Update UI elements
    updateThumbs(dt);
    updateImage(dt);
    updateFades(dt);

    // Animate forever
    requestAnimationFrame(animate);
}