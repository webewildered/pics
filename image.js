import Point from './point.js';
import Scroll from './scroll.js';
import Feeler from './feeler.js';
import {fade} from './fade.js'

const numNeighborImages = 1; // Number of image/video elements to each side of the active one.
const numTotalImages = numNeighborImages * 2 + 1;
const maxZoom = Math.log(4);

var gallery = null;
var images = []; // List of image/video elements in order from left to right. Active one is in the middle of the array. May contain nulls.
var zoomCenter = new Point(); // Point in image space to zoom about, relative to the center of the image
var enableControls = true; // Whether to show the top and bottom bars over the image
var pressed = false; // true if the image has been clicked/touched and not yet released
var mouseOrigin = new Point(); // Location where the image press began
var activeIndex = 0; // Index of the current image in the gallery
var eventTarget = new EventTarget();
var hasMouse = true; // Whether to show mouse controls
var focus = false;

const TouchMode = Object.freeze(
{
    NONE: Symbol('None'),
    NAV: Symbol('Nav'),
    BACK: Symbol('Back'),
    ZOOM: Symbol('Zoom'),
});
var touchMode = TouchMode.NONE;

// Image navigation pan
var navScroll = new Scroll();
var backScroll = new Scroll();

// Zoomed image pan and zoom
var zoomScrollX = new Scroll();
var zoomScrollY = new Scroll();
var zoomScrollZ = new Scroll();
zoomScrollZ.boundStiffness = 0.8;
var zoomScrollRangeExtension = new Point();

// Create an image or video element for the gallery entry at the given index
function createImage(index)
{
    const galleryEntry = gallery.view[index];
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
    return image;
}

// Call after changing the current image
function onChangeImage()
{
    // Get the current active image
    const image = images[numNeighborImages];
    const galleryEntry = gallery.view[activeIndex];

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
    (images[numNeighborImages - 1] == null || !hasMouse) ? $('#navButtonLeft').attr('hidden', true) : $('#navButtonLeft').removeAttr('hidden');
    (images[numNeighborImages + 1] == null || !hasMouse) ? $('#navButtonRight').attr('hidden', true) : $('#navButtonRight').removeAttr('hidden');

    // Reset zoom state
    zoomScrollZ.reset(getMinZoom(activeIndex));
}

// Call to close the image view
function closeImage()
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
    }

    eventTarget.dispatchEvent(new Event('close'));
    focus = false;
}

function navigate(direction)
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
    const newIndex = activeIndex + direction * (numNeighborImages + 1);
    let newImage = null;
    if (newIndex >= 0 && newIndex < gallery.view.length)
    {
        activeIndex = newIndex;
        newImage = createImage(activeIndex);
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
    navScroll.x += direction * getClientSize().x;

    // Display
    onChangeImage();
}

// Show or hide the control GUI
function showControls(show, immediate)
{
    enableControls = show;
    fade($('.imageBar'), enableControls, immediate ? 0 : 0.1);
}

export function init(galleryIn, hasMouseIn)
{
    gallery = galleryIn;
    hasMouse = hasMouseIn;

    // Mouse/tap input handlers
    $('#imageClick').on('mousedown', onMouseDown);
    $('#imageClick').on('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('wheel', onMouseWheel);
    Feeler.tap($('#backButton').get(0), closeImage);
    Feeler.tap($('#navButtonLeft').get(0), () => navigate(-1));
    Feeler.tap($('#navButtonRight').get(0), () => navigate(1));

    // Touch input handlers
    const imageFeeler = new Feeler($('#imageClick').get(0));
    imageFeeler.addEventListener('start', onTouchStart);
    imageFeeler.addEventListener('end', onTouchEnd);
    imageFeeler.addEventListener('move', onTouchMove);
}

export function show(index)
{
    activeIndex = index;
    fade($('#imageView'), true, 0.1);

    // Create the images
    images = [];
    for (let i = -numNeighborImages; i <= numNeighborImages; i++)
    {
        const index = activeIndex + i;
        if (index < 0 || index >= gallery.view.length)
        {
            images.push(null);
        }
        else
        {
            images.push(createImage(index));
        }
    }
    
    // Reset scroll state
    navScroll.reset();
    backScroll.reset();
    zoomScrollX.reset();
    zoomScrollY.reset();
    zoomScrollZ.reset();
    
    onChangeImage();
    enableControls = true;
    showControls(true, true); // show image bar immediate

    focus = true;
}

//
// Mouse input
//

function onMouseDown(event)
{
    pressed = true;
    mouseOrigin = new Point(event.clientX, event.clientY);
}

function onMouseMove(event)
{
    if (pressed)
    {
        let imageMousePos = new Point(event.clientX, event.clientY);
        let imageMouseDelta = imageMousePos.sub(mouseOrigin);
        if (!zoomScrollX.touch)
        {
            const deadZone = 5; // Distance the mouse must move before beginning to drag the image
            const distSq = imageMouseDelta.lengthSquared();
            if (distSq > deadZone * deadZone)
            {
                startImagePan();
                mouseOrigin = mouseOrigin.add(imageMouseDelta.mul(deadZone / Math.sqrt(distSq))).round(); // Where the mouse exits the deadzone
                imageMouseDelta = imageMousePos.sub(mouseOrigin);
            }
        }
        if (zoomScrollX.touch)
        {
            moveImagePan(imageMouseDelta);
            mouseOrigin = imageMousePos;
        }
    }
}

function onMouseUp(event)
{
    if (pressed)
    {
        if (!zoomScrollX.touch)
        {
            showControls(!enableControls, false); // toggle image bar with fade
        }
        pressed = false;
        zoomScrollX.release();
        zoomScrollY.release();
    }
}
    
function onMouseWheel(event)
{
    if (!focus)
    {
        return;
    }

    let deltaPx = event.deltaY;
    switch (event.deltaMode)
    {
        case WheelEvent.DOM_DELTA_LINE: deltaPx *= 15; break;
        case WheelEvent.DOM_DELTA_PAGE: deltaPx *= 100; break;
    }

    const zoomRate = 0.001;
    const oldZoomTarget = zoomScrollZ.target;
    const minZoom = getMinZoom(activeIndex);
    zoomScrollZ.target = Math.max(minZoom, Math.min(maxZoom, oldZoomTarget - deltaPx * zoomRate));
    zoomScrollZ.animate = true;
    if (zoomScrollZ.target == minZoom && oldZoomTarget != minZoom)
    {
        $('.navButton').css({width:'30%'}); // Big navigation buttons
    }
    else if (oldZoomTarget == minZoom && zoomScrollZ.target != minZoom)
    {
        showControls(false, false); // fade image bar out
        $('.navButton').css({width:'10%'}); // Small navigation buttons
    }

    // Find the mouse position in image space
    const imageOffset = getActiveImage().offset();
    setZoomCenter(new Point(event.clientX, event.clientY));
}

//
// Touch input
//

function onTouchStart(event)
{
    if (event.touches.length === 0)
    {
        // Only interpret touch as navigation gesture if the image is at min zoom
        if (zoomScrollZ.target !== getMinZoom(activeIndex))
        {
            touchMode = TouchMode.ZOOM;
        }
    }
    else if (event.touches.length === 1)
    {
        // Unless already in a navigation gesture, assume multitouch is zoom
        if (touchMode === TouchMode.NONE)
        {
            touchMode = TouchMode.ZOOM;
            
            // Seems to be no deadzone for multitouch - grab immediately
            if (!zoomScrollX.touch)
            {
                startImagePan();
            }
        }

        zoomScrollZ.grab();
    }
    else if (event.touches.length === 2)
    {
        event.reject();
    }
}

function onTouchEnd(event)
{
    switch (touchMode)
    {
        case TouchMode.NAV:
            if (event.touches.length == 1)
            {
                navScroll.release();
                
                // If dragged past the halfway point, or released with velocity (swiped), navigate
                const x = navScroll.x;
                const v = navScroll.v;
                const swipe = (Math.abs(v) > 200);
                const navSwipe = (swipe && Math.sign(x) == Math.sign(v));
                const navDrag = (!swipe && Math.abs(x) > getClientSize().x / 4);
                if (navSwipe || navDrag)
                {
                    navigate(-Math.sign(x));
                }
                touchMode = TouchMode.NONE;
            }
            break;
        case TouchMode.BACK:
            if (event.touches.length == 1)
            {
                backScroll.release();
                
                // If dragged down, return to thumbnail view
                if (backScroll.x > 0)
                {
                    closeImage();
                }
                touchMode = TouchMode.NONE;
            }
            break;
        case TouchMode.ZOOM:
            if (event.touches.length == 1)
            {
                if (zoomScrollX.touch)
                {
                    // Release pan
                    endImagePan();
                }
                else
                {
                    // Release tap
                    showControls(!enableControls, false); // toggle image bar with fade
                }
                touchMode = TouchMode.NONE;
            }
            else if (event.touches.length == 2)
            {
                zoomScrollZ.release();
                zoomScrollX.v = 0;
                zoomScrollY.v = 0;
                zoomScrollZ.v = 0; // no momentum
            }
            break;
        case TouchMode.NONE:
            if (event.touches.length == 1)
            {
                // Release tap
                showControls(!enableControls, false); // toggle image bar with fade
            }
            break;
    }
}

function onTouchMove(event)
{
    // If we didn't start zoomed in and this is a single finger touch, interpret it as a nav gesture
    if (touchMode === TouchMode.NONE)
    {
        const touch = event.touches[0];
        const absDelta = touch.pos.sub(touch.last).abs();
        if (absDelta.x > absDelta.y)
        {
            touchMode = TouchMode.NAV;
        }
        else
        {
            touchMode = TouchMode.BACK;
        }
    }

    switch (touchMode)
    {
        case TouchMode.NAV:
            if (navScroll.touch)
            {
                for (const touch of event.touches)
                {
                    navScroll.target += touch.pos.sub(touch.last).x;
                }
            }
            else
            {
                navScroll.grab();
            }
            break;
        case TouchMode.BACK:
            if (backScroll.touch)
            {
                for (const touch of event.touches)
                {
                    backScroll.target += touch.pos.sub(touch.last).y;
                }
            }
            else
            {
                backScroll.grab();
            }
            break;
        case TouchMode.ZOOM:
            if (event.touches.length == 1)
            {
                if (zoomScrollX.touch)
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
                zoomScrollZ.target += Math.log(scale);
                setZoomCenter(center);
            }
            break;
    }
}

//
// Input helpers
//

function startImagePan()
{
    zoomScrollX.grab();
    zoomScrollY.grab();
}

function endImagePan()
{
    zoomScrollX.release();
    zoomScrollY.release();
}

function moveImagePan(delta)
{
    zoomScrollX.target += delta.x;
    zoomScrollY.target += delta.y;
}

//
// Image positioning and zooming utils
//

function getClientSize() { return new Point(window.innerWidth, window.innerHeight); }

function getActiveImage() { return images[numNeighborImages]; }

function getNativeSize(index)
{
    const galleryEntry = gallery.view[index];
    return new Point(galleryEntry.width, galleryEntry.height);
}

function getZoomScale() { return Math.pow(Math.E, zoomScrollZ.x); }

function getMinZoomScale(index)
{
    const scaleXY = getClientSize().div(getNativeSize(index));
    return Math.min(scaleXY.x, scaleXY.y, 1);
}

function getMinZoom(index) { return Math.log(getMinZoomScale(index)); }

function getScaledSize(index, zoomed)
{
    const nativeSize = getNativeSize(index);
    let scale = zoomed ? getZoomScale() : getMinZoomScale(index);
    return nativeSize.mul(scale);
}

function setZoomCenter(clientPos)
{
    const image = getActiveImage();
    const imageOffset = image.offset();
    const nativeSize = getNativeSize(activeIndex);
    zoomCenter = clientPos
        .sub(new Point(imageOffset.left, imageOffset.top)) // Relative to topleft corner
        .div(getZoomScale()) // In native scale
        .max(0).min(nativeSize) // Clamped to image
        .sub(nativeSize.div(2)); // Relative to image center
}

export function update(dt)
{
    if (images.length == 0)
    {
        return;
    }
    
    // Calculate the scroll range - the minimum necessary to be able to see the whole image by scrolling, plus any extra specified by
    // zoomScrollRangeExtension (positive values extend max, negative values extend min)
    let scrollRange, scrollMin, scrollMax;
    function calcScrollRange()
    {
        const imageSize = getScaledSize(activeIndex, true);
        scrollRange = imageSize.sub(getClientSize()).max(0).div(2);
        scrollMax = scrollRange.add(zoomScrollRangeExtension.max(0));
        scrollMin = scrollRange.neg().add(zoomScrollRangeExtension.min(0));
    }

    // Calculate current excess of the scroll range
    calcScrollRange();
    const scroll = new Point(zoomScrollX.x, zoomScrollY.x);
    const overMax = scroll.sub(scrollMax).max(0);
    const underMin = scroll.sub(scrollMin).min(0);
    
    // Animate zoom
    const oldZoomScale = getZoomScale();
    const minZoom = getMinZoom(activeIndex);
    zoomScrollZ.update(dt, minZoom, maxZoom);
    const zoomScale = getZoomScale();

    if (zoomScrollZ.target <= minZoom && !zoomScrollZ.touch)
    {
        // Reset scroll range extension and recenter
        zoomScrollRangeExtension = new Point();
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
        zoomScrollRangeExtension = zoomScrollRangeExtension.binary(newScrollRangeExtension, (a, b) =>
        {
            if (Math.abs(b) < 1e-5)
            {
                return a; // Ignore tiny changes, can get b==0 or maybe an opposite-signed value from numerical error
            }
            return Math.sign(a) == Math.sign(b) ? a + b : b;
        });

        // If scrolled back towards the natural range, reduce the extension
        zoomScrollRangeExtension = zoomScrollRangeExtension
            .min(newScroll.sub(scrollRange).max(0))
            .max(newScroll.sub(scrollRange.neg()).min(0));

        // Apply the shift
        zoomScrollX.x += zoomShift.x;
        zoomScrollX.target += zoomShift.x;
        zoomScrollY.x += zoomShift.y;
        zoomScrollY.target += zoomShift.y;
        
        calcScrollRange(); // Recalculate the range
    }

    // Animate scroll
    const navScrollLimit = navScroll.touch ? 1e10 : 0; // Scroll freely while grabbed, snap when released
    navScroll.update(dt, -navScrollLimit, navScrollLimit);
    const backScrollLimit = backScroll.touch ? 1e10 : 0;
    backScroll.update(dt, 0, backScrollLimit);
    zoomScrollX.update(dt, scrollMin.x, scrollMax.x);
    zoomScrollY.update(dt, scrollMin.y, scrollMax.y);

    const imageScroll = new Point(navScroll.x, backScroll.x);
    const neighborShift = new Point(getClientSize().x, 0);
    for (let i = 0; i < numTotalImages; i++)
    {
        const image = images[i];
        if (image === null)
        {
            continue;
        }
        const offset = i - numNeighborImages;
        const index = activeIndex + offset;
        const galleryEntry = gallery.view[activeIndex + offset];
        const scaledSize = getScaledSize(index, offset === 0);
        const zoomScroll = (offset === 0) ? new Point(zoomScrollX.x, zoomScrollY.x) : new Point();
        const position = getClientSize()
            .sub(scaledSize).div(2) // Center
            .add(imageScroll) // Apply scroll
            .add(zoomScroll)
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

export function addEventListener(name, listener)
{
    eventTarget.addEventListener(name, listener);
}