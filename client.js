import Point from './point.js';
import Scroll from './scroll.js';

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

var zoom = 1;
var zoomTarget = 1;
var zoomCenter = new Point(); // Point in image space to zoom about, relative to the center of the image
var zoomMin = 1;
var nativeSize = new Point();
var enableImageControls = true; // Whether to show the top and bottom bars over the image
var imagePressed = false; // true if the image has been clicked/touched and not yet released
var imageMouseOrigin = new Point(); // Location where the image press began
var imageScrollX = new Scroll(); // Image pan
var imageScrollY = new Scroll();
var imageScrollRangeExtension = new Point();

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
        .attr('draggable', false)
        .addClass('noSelect')
        .appendTo(thumbs);
    image.on('click', () => clickThumb(galleryEntry));
    const isEnd = ($('#thumbs').children().length % thumbPitch) == 0;
    styleImage(image, isEnd);
}

var image;
var imageIndex;
function setImage(index)
{
    const oldImage = image;
    const galleryEntry = gallery.images[index];
    imageIndex = index;

    // Calculate the initial zoom
    nativeSize = new Point(galleryEntry.width, galleryEntry.height)
    zoomMin = Math.min(1, window.innerWidth / nativeSize.x, window.innerHeight / nativeSize.y);
    zoom = zoomMin;
    zoomTarget = zoom;
    imageScrollX.reset();
    imageScrollY.reset();
    
    const date = new Date(galleryEntry.date);
    const format = new Intl.DateTimeFormat();
    format.dateStyle = 'full';
    $('#time').text(date.toLocaleString(format));
    $('#location').text(galleryEntry.location);

    image = $('<img>')
        .attr('src', 'images/' + galleryEntry.file)
        .attr('draggable', false)
        .addClass('mainImage')
        .addClass('noSelect')
    image.on('load', () =>
    {
        // Clear existing image
        if (oldImage)
        {
            oldImage.remove();
        }
    });
    updateImageTransform();
    image.appendTo('#imageView');
}

function clickThumb(galleryEntry)
{
    fade($('#imageView'), true, 0.1);

    setImage(galleryEntry.index);
    
    focus = imageMode;
    enableImageControls = true;
    showImageBar(true, true); // show image bar immediate
}

function onNav(direction)
{
    let newIndex = Math.min(Math.max(imageIndex + direction, 0), gallery.images.length);
    if (newIndex != imageIndex)
    {
        setImage(newIndex);
    }
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
        if (response.status !== 200)
        {
            const error = await response.text();
            console.log(error);
        }
        else
        {
            const galleryEntry = await response.json();
            console.log('Added ' + galleryEntry.title);
            galleryEntry.index = gallery.images.length;
            gallery.images.push(galleryEntry);
            addImage(galleryEntry);
            count++;
        }
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
        console.log('width ' + width + ' pitch ' + thumbPitch + ' size ' + thumbSize);
        
        styleImage($('#thumbs').children(), false);
        styleImage($('#thumbs img:nth-child(' + thumbPitch + 'n)'), true);
    }
}
window.onresize = layout;

var gallery;
window.onload = () =>
{
    // Load the gallery
    const thumbs = $('#thumbs');
    fetch('galleries/' + getGalleryKey() + '.json')
        .then((response) => response.json())
        .then((json) =>
        {
            gallery = json;
            for (let i = 0; i < gallery.images.length; i++)
            {
                const galleryEntry = gallery.images[i];
                galleryEntry.index = i;
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
    $('#imageClick').on('mousedown', onImageMousedown);
    $('#navButtonLeft').on('click', () => onNav(-1));
    $('#navButtonRight').on('click', () => onNav(1));

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
    if (touches.length == 0)
    {
        thumbScroll.grab();
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
        if (!imageScrollX.touch)
        {
            const deadZone = 5; // Distance the mouse must move before beginning to drag the image
            if (imageMouseOrigin.distanceSquared(new Point(event.clientX, event.clientY)) > deadZone * deadZone)
            {
                imageScrollX.grab();
                imageScrollY.grab();
            }
        }
        if (imageScrollX.touch)
        {
            imageScrollX.target += event.movementX;
            imageScrollY.target += event.movementY;
        }
        return;
    }
}

onmouseup = () =>
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
                    $('.navButton').css({width:'30%'}); // Big navigation buttons
                }
                else if (oldZoomTarget == zoomMin && zoomTarget != zoomMin)
                {
                    showImageBar(false, false); // fade image bar out
                    $('.navButton').css({width:'10%'}); // Small navigation buttons
                }

                // Find the mouse position in image space
                const imageOffset = image.offset();
                zoomCenter = new Point(event.clientX - imageOffset.left, event.clientY - imageOffset.top)
                    .div(zoom) // Relative to topleft corner
                    .max(0).min(nativeSize) // Clamped to image
                    .sub(nativeSize.div(2)); // Relative to image center
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

function clientSize() { return new Point(window.innerWidth, window.innerHeight); }
function imageSize() { return nativeSize.mul(zoom); }

function updateImageTransform()
{
    const scaledSize = imageSize();
    const scaledPosition = clientSize().sub(scaledSize).div(2).add(new Point(imageScrollX.x, imageScrollY.x))
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
        // Animate zoom
        const newZoom = zoomTarget - decay(zoomTarget - zoom, dt, 0.0000001);

        let scrollRange, scrollMin, scrollMax;
        if (zoomTarget == zoomMin)
        {
            // Reset scroll range extension and recenter
            imageScrollRangeExtension = new Point();
            scrollRange = new Point();
            scrollMin = new Point();
            scrollMax = new Point();
            zoom = newZoom;
        }
        else
        {

            // Calculate the position change required to maintain the position of the zoomCenter in screen space
            const zoomShift = zoomCenter.mul(zoom - newZoom);

            // Calculate the scroll range - the minimum necessary to be able to see the whole image by scrolling, plus any extra specified by
            // imageScrollRangeExtension (positive values extend max, negative values extend min)
            function calcScrollRange()
            {
                scrollRange = imageSize().sub(clientSize()).max(0).div(2);
                scrollMax = scrollRange.add(imageScrollRangeExtension.max(0));
                scrollMin = scrollRange.neg().add(imageScrollRangeExtension.min(0));
            }

            // Calculate current excess of the scroll range
            calcScrollRange();
            const scroll = new Point(imageScrollX.x, imageScrollY.x);
            const overMax = scroll.sub(scrollMax).max(0);
            const underMin = scroll.sub(scrollMin).min(0);
            
            // Apply zoom and recalculate the scroll range
            zoom = newZoom;
            calcScrollRange();

            // Apply zoom shift and calculate new excess of the scroll range
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