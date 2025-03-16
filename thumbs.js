import Scroll from './scroll.js';
import Feeler from './feeler.js';

const res = 200; // Native size of thumbnail images in px
const margin = 2; // Horizontal space between thumbnails in px
var gallery = null;
var focus = true; // Whether the view should handle global input events (mouse wheel, keystroke)
var cols = 0; // Number of thumbnails per row
var rows = 0; // Number of rows of thumbnails
var size = 0; // Displayed thumbnail size
var sizeEnd = 0; // Width of the last thumbnail in column, slightly smaller than size if cols does not divide the client width
var virtualRow = 0; // Index of the row that the first row of thumbnails represents
var scroll = new Scroll();
scroll.enableAcceleration = true;
var eventTarget = new EventTarget();
var years = []; // List of {year:Number, index:Number} sorted by ascending year
var timelineScrolling = false;
var mouseY = 0;

// // Measure year height
// function getHeightFromClass(className) {
//     const tempElement = document.createElement('div');
//     tempElement.className = className;
//     tempElement.textContent = '1234'; // Some text is needed to apply styles
//     tempElement.style.position = 'absolute';
//     tempElement.style.visibility = 'hidden';
//     document.body.appendChild(tempElement);
//     const height = tempElement.getBoundingClientRect().height;
//     document.body.removeChild(tempElement);
//     return parseFloat(height); // Convert 'px' to a number
// }
// const yearHeight = getHeightFromClass('year');
const yearHeight = 18;
const yearMargin = 5;
const yearSpace = yearHeight + yearMargin;

function updateThumbImage(thumbIndex, thumbElement)
{
    if (thumbElement === undefined)
    {
        thumbElement = $('#thumbs > :nth-child(' + (thumbIndex + 1) + ')');
    }

    const imageIndex = virtualRow * cols + thumbIndex;
    if (imageIndex < gallery.view.length)
    {
        thumbElement.attr('src', '');
        thumbElement.attr('src', 'thumbs/' + gallery.view[imageIndex].thumb);
        thumbElement.removeAttr('hidden');
    }
    else
    {
        thumbElement.attr('hidden', true);
    }
}

function updateAllThumbs()
{
    $('#thumbs').children().each((index, element) =>
    {
        updateThumbImage(index, $(element));
    });
}

function click(thumbIndex)
{
    let event = new Event('click');
    event.index = thumbIndex + cols * virtualRow;
    eventTarget.dispatchEvent(event);
}

function getTimelineRange()
{
    return $('#thumbTimeline').height() - yearHeight - 2 * yearMargin;
}

function getTimelineY(fraction)
{
    return yearMargin + fraction * getTimelineRange();
}

function getTimelineFraction(timelineY)
{
    return (timelineY - yearMargin) / getTimelineRange();
}

// Place year labels on the timeline
function updateYears()
{
    const timeline = $('#thumbTimeline');
    timeline.find('.year').remove();
    const galleryRows = Math.ceil(gallery.view.length / cols);
    const visibleRows = timeline.height() / size;
    const scrollRows = galleryRows - visibleRows;
    if (scrollRows > 0)
    {
        let lastY = -yearSpace;
        let lastElem = null;
        for (let i = 0; i < years.length; i++)
        {
            const year = years[i];
            const yearRow = Math.floor(year.index / cols);
            const yearFraction = Math.min(1, yearRow / scrollRows);
            const y = getTimelineY(yearFraction);
            const hasSpace = (y - lastY >= yearSpace);
            if (!hasSpace)
            {
                if (i == years.length - 1 && lastElem)
                {
                    // Always show the last year
                    lastElem.remove();
                }
                else
                {
                    // Skip years that don't fit
                    continue;
                }
            }
            lastY = y;
            lastElem = $('<div>')
                .text(year.year)
                .css('top', y)
                .addClass('noSelect')
                .addClass('year')
                .appendTo(timeline);
        }
    }
}

export function init(galleryIn, hasMouseIn)
{
    gallery = galleryIn;

    // Hide the timeline scroller if there is no mouse
    if (!hasMouseIn)
    {
        $('#thumbTimeline').hide();
    }

    // Create and position thumbnails as the view resizes
    const thumbContainer = $('#thumbContainer');
    function resize()
    {
        // Make a grid of thumbnail images. First choose the number of thumbs per row to minimize the downscaling required for a perfect fit.
        // Then choose the number of rows so that the container is covered.
        const width = thumbContainer.width();
        const height = thumbContainer.height();
        const newCols = Math.ceil((width + margin) / (res + margin));
        const newSize = Math.ceil((width + margin) / newCols - margin);
        const newSizeEnd = width - (newCols - 1) * (newSize + margin);
        const newRows = Math.ceil(height / newSize) + 1;
        const needResize = (newCols !== cols || newSize !== size || newSizeEnd !== sizeEnd);
        if (newRows !== rows || needResize)
        {
            cols = newCols;
            rows = newRows;
            size = newSize;
            sizeEnd = newSizeEnd;

            // Adjust the number of thumbnails
            const numThumbs = $('#thumbs').children().length;
            const newNumThumbs = cols * rows;

            if (numThumbs != newNumThumbs)
            {
                if (numThumbs > newNumThumbs)
                {
                    // Remove the excess thumbnails
                    $('#thumbs').children().slice(newNumThumbs - numThumbs).remove();
                }
                for (let i = numThumbs; i < newNumThumbs; i++)
                {
                    // Add a thumbnail
                    const image = $('<img>')
                        .attr('draggable', false)
                        .addClass('noSelect')
                        .appendTo(thumbs);
                    image.on('click', () => click(i));
                }

                // Update all thumb images
                updateAllThumbs();
            }
                
            if (needResize)
            {
                // Set the thumbnails' sizes
                $('#thumbs').children()
                    .attr('width', size)
                    .attr('height', size)
                    .attr('class', 'thumb noSelect');
                $('#thumbs img:nth-child(' + cols + 'n)')
                    .attr('width', sizeEnd)
                    .attr('height', size)
                    .attr('class', 'thumb-end noSelect');
            }
        }

        updateYears();
    }
    resize();
    new ResizeObserver(resize).observe(thumbContainer.get(0));
    
    // Listen for changes in the gallery view to apply them to the thumbnails
    gallery.addEventListener('change', (event) =>
    {
        // Find the range of changed images that are currently represented by thumbnails
        const minImageIndex = cols * virtualRow;
        const maxImageIndex = minImageIndex + $('#thumbs').children().length - 1;
        const minThumbIndex = Math.max(minImageIndex, event.minIndex) - minImageIndex;
        const maxThumbIndex = Math.min(maxImageIndex, event.maxIndex) - minImageIndex;
        for (let i = minThumbIndex; i <= maxThumbIndex; i++)
        {
            updateThumbImage(i);
        }

        // TODO can optimize this if it's a problem
        years = [];
        let lastYear = 0;
        for (let i = 0; i < gallery.view.length; i++)
        {
            const year = gallery.view[i].date.getFullYear();
            if (year > lastYear)
            {
                lastYear = year;
                years.push({year: year, index: i});
            }
        }
        updateYears();
    });
    
    // Handle touch input
    const thumbFeeler = new Feeler($('#thumbContainer').get(0));
    thumbFeeler.addEventListener('start', (event) => 
    {
        if (event.touches.length)
        {
            event.reject();
        }
        else
        {
            scroll.v = 0;
        }
    });
    thumbFeeler.addEventListener('end', (event) =>
    {
        if (scroll.touch)
        {
            scroll.release();
        }
        else
        {
            // Finger didn't move, so interpret this as a tap
            const thumb = document.elementFromPoint(event.touches[0].pos.x, event.touches[0].pos.y);
            if (thumb.classList.contains('thumb') || thumb.classList.contains('thumb-end'))
            {
                click($(thumb).index());
            }
        }
    });
    thumbFeeler.addEventListener('move', (event) =>
    {
        if (scroll.touch)
        {
            const touch = event.touches[0];
            scroll.target -= touch.pos.y - touch.last.y;
        }
        else
        {
            // Ignore delta on the first move event. Something below us on the stack implements a deadzone, so we
            // see a big jump on the first move, which we want to skip.
            scroll.grab();
        }
    });

    // Handle mouse wheel
    window.addEventListener('wheel', (event) =>
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
        
        scroll.animate = true;
        scroll.target += deltaPx;
    });

    // Handle key presses
    window.addEventListener('keydown', (event) =>
    {
        if (!focus)
        {
            return;
        }

        switch (event.code)
        {
            case 'PageDown':
                scroll.animate = true;
                scroll.target += thumbContainer.height();
                break;
            case 'PageUp':
                scroll.animate = true;
                scroll.target -= thumbContainer.height();
                break;
            case 'Home':
                scroll.animate = true;
                scroll.target = 0;
                break;
            case 'End':
                scroll.animate = true;
                scroll.target = Number.POSITIVE_INFINITY;
                break;
        }
    })

    // Mouse input for timeline scrolling
    $('#thumbTimeline').on('mousedown', () => timelineScrolling = true);
    window.addEventListener('mouseup', () => timelineScrolling = false);
    window.addEventListener('mousemove', (event) => mouseY = event.clientY);
}

export function update(dt)
{
    const thumbs = $('#thumbs');
    const thumbContainer = $('#thumbContainer');

    // Calculate the scroll range
    const virtualThumbRows = Math.ceil(gallery.view.length / cols);
    const virtualThumbHeight = virtualThumbRows * size;
    const minScroll = 0;
    const panelHeight = thumbContainer.height();
    const maxScroll = Math.max(virtualThumbHeight - panelHeight, 0);

    // Animate scroll
    if (timelineScrolling)
    {
        let timelineY = mouseY - $('#thumbTimeline').offset().top - yearHeight / 2;
        let timelineFraction = getTimelineFraction(timelineY);
        timelineFraction = Math.min(Math.max(timelineFraction, 0), 1);
        scroll.reset(timelineFraction * maxScroll);
    }
    else
    {
        scroll.update(dt, minScroll, maxScroll);
    }
    const oldVirtualRow = virtualRow;
    const scrollClamped = Math.min(maxScroll, Math.max(minScroll, scroll.x));
    virtualRow = Math.floor(scrollClamped / size);

    // Update the thumb images if necessary
    if (virtualRow !== oldVirtualRow)
    {
        thumbs.children().each((index, element) =>
        {
            updateThumbImage(index, $(element));
        });
    }

    // Position the scroll line
    const scrollFraction = scrollClamped / maxScroll;
    const scrollY = getTimelineY(scrollFraction) + yearHeight / 2;
    $('#thumbTimelineCursor').css('top', scrollY);

    // Position the thumbs
    const thumbDisplacement = scroll.x - virtualRow * size;
    thumbs.css({position: 'relative', top: -thumbDisplacement});
}

export function setFocus(focusIn)
{
    focus = focusIn;
}

export function addEventListener(name, listener)
{
    eventTarget.addEventListener(name, listener);
}