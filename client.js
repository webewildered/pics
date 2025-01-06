import Point from './point.js';
import Scroll from './scroll.js';

//
// GUI mode
//

const galleryMode = "galleryMode";
const imageMode = "imageMode";
var focus = galleryMode;

//
// Image viewing
//

var zoom = 1;
var zoomTarget = 1;
var zoomCenter = new Point(); // Point in image space to zoom about, relative to the center of the image
var zoomMin = 1;
var nativeSize = new Point();
var enableImageControls = true; // Whether to show the top and bottom bars over the image
var imagePressed = false; // true if the image has been clicked/touched and not yet released
var imageDrag = false; // True if the image is being dragged
var imageMouseOrigin = new Point(); // Location where the image press began
var imageOffset = new Point(); // Screenspace offset of the image from center

//
// Gallery
//

const thumbRes = 200; // Native size of thumbnail images in px
const thumbMargin = 2; // Horizontal space between thumbnails in px
var thumbPitch = 0; // Number of thumbnails per row
var thumbSize = 0; // Displayed thumbnail size
var thumbSizeEnd = 0; // End thumbnail's width
var thumbScroll = new Scroll();

function getGalleryKey()
{
    return window.location.search.substring(1);
}

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
        .appendTo(thumbs);
    image.on('click', () => clickThumb(galleryEntry));
    const isEnd = ($('#thumbs').children().length % thumbPitch) == 0;
    styleImage(image, isEnd);
}

var image;
function clickThumb(galleryEntry)
{
    fade($('#imageView'), true, 0.1);
    
    // Calculate the initial zoom
    nativeSize = new Point(galleryEntry.width, galleryEntry.height)
    zoomMin = Math.min(1, window.innerWidth / nativeSize.x, window.innerHeight / nativeSize.y);
    zoom = zoomMin;
    zoomTarget = zoom;
    imageOffset = new Point();

    image = $('<img>')
        .attr('src', 'images/' + galleryEntry.file)
        .attr('draggable', false)
        .css({ 'position': 'absolute' });
    updateImageTransform();
    image.appendTo('#imageView');
    
    focus = imageMode;
    enableImageControls = true;
    showImageBar(true, true); // show image bar immediate
}

function showImageBar(show, immediate)
{
    enableImageControls = show;
    fade($('.imageBar'), enableImageControls, immediate ? 0 : 0.1);
}

function clickBackButton()
{
    if (image)
    {
        image.remove();
        image = null;
        fade($('#imageView'), false, 0.1);
        focus = galleryMode;
    }
}

async function upload(event)
{
    event.preventDefault();

    const files = document.getElementById('fileInput');
    let count = 0;
    for (const file of files.files)
    {
        const formData = new FormData();
        formData.append('galleryKey', getGalleryKey());
        formData.append('image', file);
        const response = await fetch('api/upload', { method: 'POST', body: formData });
        const galleryEntry = await response.json();
        if (Object.hasOwn(galleryEntry, 'error'))
        {
            console.log('Error: ' + galleryEntry.error);
        }
        else
        {
            console.log('Added ' + galleryEntry.title);
            addImage(galleryEntry);
            count++;
        }
    }
    console.log('Uploaded ' + count + ' images');
}

function layout()
{
    const newThumbPitch = Math.ceil((document.body.clientWidth + thumbMargin) / (thumbRes + thumbMargin));
    const newThumbSize = Math.ceil((document.body.clientWidth + thumbMargin) / newThumbPitch - thumbMargin);
    const newThumbSizeEnd = document.body.clientWidth - (newThumbPitch - 1) * (newThumbSize + thumbMargin);
    if (newThumbPitch !== thumbPitch || newThumbSize !== thumbSize || newThumbSizeEnd !== thumbSizeEnd)
    {
        thumbPitch = newThumbPitch;
        thumbSize = newThumbSize;
        thumbSizeEnd = newThumbSizeEnd;
        console.log('width ' + document.body.clientWidth + ' pitch ' + thumbPitch + ' size ' + thumbSize);
        
        styleImage($('#thumbs').children(), false);
        styleImage($('#thumbs img:nth-child(' + thumbPitch + 'n)'), true);
    }
}
window.onresize = layout;

window.onload = () =>
{
    // Load the gallery
    const thumbs = $('#thumbs');
    fetch('galleries/' + getGalleryKey() + '.json')
        .then((response) => response.json())
        .then((gallery) =>
        {
            for (const galleryEntry of gallery.images)
            {
                addImage(galleryEntry);
            }
        })
        .catch((error) =>
        {
            $('<span>error: ' + error + '</span>').appendTo(thumbs);
        });
    layout();

    // Handle input events
    $('#uploadButton').on('click', upload);
    $('#backButton').on('click', clickBackButton);
    $('#imageView').on('mousedown', onImageMousedown);


    // Handle thumbnails touch inputs
    const thumbContainer = $('#thumbContainer');
    thumbContainer.on('touchstart', onTouchStart);
    thumbContainer.on('touchend', onTouchEnd);
    thumbContainer.on('touchmove', onTouchMove);

    // Animate
    tLast = window.performance.now();
    requestAnimationFrame(animate);
}

//
// Touch handlers
//

function getTouchIndex(eventTouch)
{
    for (let i = 0; i < touches.length; i++)
    {
        if (touches[i].identifier === eventTouch.identifier)
        {
            return i;
        }
    }
    return -1;

}

function getTouch(eventTouch)
{
    let touchIndex = getTouchIndex(eventTouch);
    return (touchIndex >= 0) ? touches[touchIndex] : null;
}

function removeTouch(eventTouch)
{
    let touchIndex = getTouchIndex(eventTouch);
    if (touchIndex >= 0)
    {
        touches.splice(touchIndex, 1);
    }
}
 
var touches = [];
function onTouchStart(event)
{
    thumbScroll.animate = false;
    thumbScroll.touch = true;
    if (touches.length == 0)
    {
        thumbScroll.target = thumbScroll.x;
    }
    for (const eventTouch of event.changedTouches)
    {
        touches.push({pageY: eventTouch.pageY, identifier: eventTouch.identifier});
    }
}

function onTouchMove(event)
{
    for (const eventTouch of event.changedTouches)
    {
        const touch = getTouch(eventTouch);
        if (touch == null)
        {
            continue;
        }

        const deltaY = eventTouch.pageY - touch.pageY;
        thumbScroll.target -= deltaY;
        touch.pageY = eventTouch.pageY;
    }
}

function onTouchEnd(event)
{
    for (const eventTouch of event.changedTouches)
    {
        removeTouch(eventTouch);
    }
    thumbScroll.touch = (touches.length > 0);
}

//
// PC input handlers
//

function onImageMousedown(event)
{
    imagePressed = true;
    imageMouseOrigin = new Point(event.clientX, event.clientY);
}

onmousemove = (event) =>
{
    if (imagePressed)
    {
        if (!imageDrag)
        {
            const deadZone = 5; // Distance the mouse must move before beginning to drag the image
            if (imageMouseOrigin.distanceSquared(new Point(event.clientX, event.clientY)) > deadZone * deadZone)
            {
                imageDrag = true;
            }
        }
        if (imageDrag)
        {
            imageOffset = imageOffset.add(new Point(event.movementX, event.movementY));
        }
        return;
    }
}

onmouseup = () =>
{
    if (imagePressed)
    {
        if (!imageDrag)
        {
            showImageBar(!enableImageControls, false); // toggle image bar with fade
        }
        imagePressed = false;
        imageDrag = false;
    }
}

onwheel = (event) =>
{
    switch (focus)
    {
        case galleryMode:
            thumbScroll.animate = true;
            if (event.deltaMode === WheelEvent.DOM_DELTA_PIXEL)
            {
                thumbScroll.target += event.deltaY;
            }
            break;
        case imageMode:
            if (event.deltaMode === WheelEvent.DOM_DELTA_PIXEL)
            {
                const zoomRate = 1.001;
                const zoomDelta = Math.pow(zoomRate, -event.deltaY);
                const oldZoomTarget = zoomTarget;
                zoomTarget = Math.max(zoomMin, Math.min(4.0, zoomTarget * zoomDelta));
                if (zoomTarget == zoomMin && oldZoomTarget != zoomMin)
                {
                    showImageBar(true, false); // fade image bar in
                }
                else if (oldZoomTarget == zoomMin && zoomTarget != zoomMin)
                {
                    showImageBar(false, false); // fade image bar out
                }

                // Find the mouse position in image space
                const imageOffset = image.offset();
                zoomCenter = new Point(event.clientX - imageOffset.left, event.clientY - imageOffset.top).div(zoom).sub(nativeSize.div(2));
            }
    }

    // TODO maybe need to handle other modes:
    // switch (event.deltaMode)
    // {
    //     case WheelEvent.DOM_DELTA_PIXEL: window.scrollBy(0, event.deltaY); break;
    //     case WheelEvent.DOM_DELTA_LINE: window.scrollByLines(0, event.deltaY); break;
    //     case WheelEvent.DOM_DELTA_PAGE: window.scrollByPages(0, event.deltaY); break;
    // }
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

function updateImageTransform()
{
    let scaledSize = nativeSize.mul(zoom);
    let scaledPosition = new Point(window.innerWidth, window.innerHeight).sub(scaledSize).div(2).add(imageOffset)
    image.css(
    {
        'width': scaledSize.x,
        'height': scaledSize.y,
        'left': scaledPosition.x,
        'top': scaledPosition.y
    });
}

function updateImage(dt)
{
    if (image)
    {
        const newZoom = zoomTarget - decay(zoomTarget - zoom, dt, 0.0000001);
        const zoomShift = zoomCenter.mul(newZoom - zoom);
        imageOffset = imageOffset.sub(zoomShift);
        zoom = newZoom;
        updateImageTransform();
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