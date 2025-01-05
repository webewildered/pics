
//
// GUI mode
//

const galleryMode = "galleryMode";
const imageMode = "imageMode";
var focus = galleryMode;

//
// Scrolling
//

var scrollTouch = false; // True if scrolling is in touch mode, false in PC mode
var scroll = 0; // Current scroll distance from top
var scrollTarget = 0; // In PC mode, the target scroll to animate towards
var scrollVelocity = 0; // In touch mode, the current scrolling velocity

//
// Image viewing
//

var zoom = 1;
var zoomTarget = 1;
var zoomMin = 1;
var naturalWidth = 0;
var naturalHeight = 0;
var enableImageControls = true; // Whether to show the top and bottom bars over the image

//
// Gallery
//

const thumbRes = 200; // Native size of thumbnail images in px
const thumbMargin = 2; // Horizontal space between thumbnails in px
var thumbPitch = 0; // Number of thumbnails per row
var thumbSize = 0; // Displayed thumbnail size
var thumbSizeEnd = 0; // End thumbnail's width

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

let image;
function clickThumb(galleryEntry)
{
    fade($('#imageView'), true, 0.1);
    
    // Calculate the initial zoom
    naturalWidth = galleryEntry.width;
    naturalHeight = galleryEntry.height;
    zoomMin = Math.min(1, window.innerWidth / naturalWidth, window.innerHeight / naturalHeight);
    zoom = zoomMin;
    zoomTarget = zoom;
    imageProps = calcImageProperties(image, zoom);

    image = $('<img>')
        .attr('src', 'images/' + galleryEntry.file)
        .css(
        {
            'position': 'absolute',
            'width': imageProps.width,
            'height': imageProps.height,
            'left': imageProps.x,
            'top': imageProps.y
        })
        .appendTo('#imageView');
    image.on('click', (event) =>
        {
            enableImageControls = !enableImageControls
            fade($('.imageBar'), enableImageControls, 0.1);
        });
    
    focus = imageMode;
    enableImageControls = true;
    fade($('.imageBar'), enableImageControls);
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
    var count = 0;
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

    // Handle gui events
    $('#uploadButton').on('click', upload);
    $('#backButton').on('click', clickBackButton);

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
    scrollTouch = true;
    if (touches.length == 0)
    {
        scrollTarget = scroll;
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
        scrollTarget -= deltaY;
        touch.pageY = eventTouch.pageY;
    }
}

function onTouchEnd(event)
{
    for (const eventTouch of event.changedTouches)
    {
        removeTouch(eventTouch);
    }
}

//
// PC input handlers
//

onwheel = (event) =>
{
    switch (focus)
    {
        case galleryMode:
            scrollTouch = false;
            if (event.deltaMode === WheelEvent.DOM_DELTA_PIXEL)
            {
                scrollTarget += event.deltaY;
            }
            break;
        case imageMode:
            if (event.deltaMode === WheelEvent.DOM_DELTA_PIXEL)
            {
                const zoomRate = 1.001;
                const zoomDelta = Math.pow(zoomRate, -event.deltaY);
                zoomTarget = Math.max(zoomMin, Math.min(4.0, zoomTarget * zoomDelta));
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
let fades = [];
function fade(elements, fadeIn, duration = 0)
{
    elements.each(function()
    {
        const element = $(this);
        for (var i = 0; i < fades.length; i++)
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
                var rate = 1 / duration;
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

        var rate = 1 / duration;
        fades.push({
            element: element,
            fadeIn: fadeIn,
            rate: rate
        });
    });
}

function updateFades(dt)
{
    for (var i = 0; i < fades.length; i++)
    {
        const fade = fades[i];
        opacity = Number(fade.element.css('opacity'));
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

function updateScroll(dt)
{
    const thumbs = $('#thumbs');
    const thumbContainer = $('#thumbContainer');

    function setScroll(newScroll)
    {
        scroll = newScroll;
        thumbs.css({position: 'relative', top: -newScroll});
    }

    // Calculate the scroll range
    const minScroll = 0;
    const contentHeight = thumbs.prop('scrollHeight');
    const panelHeight = thumbContainer.height();
    const maxScroll = Math.max(contentHeight - panelHeight, 0);

    if (scrollTouch)
    {
        // Calculate distance past the scroll boundary
        calcOverScroll = (x) => Math.min(0, x - minScroll) + Math.max(0, x - maxScroll);

        // Touch mode
        if (touches.length > 0)
        {
            // Finger down:
            // Within bounds, track the finger movement directly.
            // Out of bounds, lag behind, simulating a force pulling back towards the bounds.
            var overScroll = calcOverScroll(scrollTarget);
            var newScroll = scrollTarget;
            if (overScroll != 0)
            {
                newScroll = newScroll - overScroll + Math.pow(Math.abs(overScroll), 0.8) * Math.sign(overScroll);
            }
            scrollVelocity = (newScroll - scroll) / dt;
            setScroll(newScroll);
        }
        else
        {
            // Finger released
            var overScroll = calcOverScroll(scroll);
            if (overScroll == 0)
            {
                // Within bounds, damp velocity
                scrollVelocity = decay(scrollVelocity, dt, 0.1);
            }
            else
            {
                // Out of bounds, pull toward the bounds with a critically damped spring
                const w = 5; // angular frequency
                const v = scrollVelocity;
                const x = overScroll;
                scrollVelocity = (v - dt * w * w * x) / (1 + 2 * dt * w + dt * dt * w * w); // implicit integration
            }

            setScroll(scroll + scrollVelocity * dt);
        }
    }
    else
    {
        // PC mode: Clamp the scroll target
        scrollTarget = Math.max(scrollTarget, minScroll);
        scrollTarget = Math.min(scrollTarget, maxScroll);

        // Animate to the target
        var newScroll = scrollTarget - decay(scrollTarget - scroll, dt, 0.0000001, 1);
        setScroll(newScroll);
    }
}

function calcImageProperties(image, zoom)
{
    var width = naturalWidth * zoom;
    var height = naturalHeight * zoom;
    return {
        x: (window.innerWidth - width) / 2,
        y: (window.innerHeight - height) / 2,
        width: width,
        height: height
    };
}

function updateImage(dt)
{
    if (image)
    {
        zoom = zoomTarget - decay(zoomTarget - zoom, dt, 0.0000001);
        imageProps = calcImageProperties(image, zoom);
        image.css(
        {
            'width': imageProps.width,
            'height': imageProps.height,
            'left': imageProps.x,
            'top': imageProps.y
        });
    }
}

let tLast;
function animate(t)
{
    // Calculate time since the last animate() call
    const dt = (t - tLast) * 1e-3;
    tLast = t;
    
    // Update UI elements
    updateScroll(dt);
    updateImage(dt);
    updateFades(dt);

    // Animate forever
    requestAnimationFrame(animate);
}