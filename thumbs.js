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
var eventTarget = new EventTarget();

function updateThumbImage(index, thumb)
{
    if (thumb === undefined)
    {
        thumb = $('#thumbs > :nth-child(' + (index + 1) + ')');
    }

    if (index < gallery.view.length)
    {
        thumb.attr('src', 'thumbs/' + gallery.view[index].thumb);
        thumb.removeAttr('hidden');
    }
    else
    {
        thumb.attr('hidden', true);
    }
}

function click(thumbIndex)
{
    let event = new Event('click');
    event.index = thumbIndex + cols * virtualRow;
    eventTarget.dispatchEvent(event);
}

export function init(galleryIn)
{
    gallery = galleryIn;

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
        if (newCols !== cols || newRows !== rows || newSize !== size || newSizeEnd !== sizeEnd)
        {
            cols = newCols;
            rows = newRows;
            size = newSize;
            sizeEnd = newSizeEnd;

            // Adjust the number of thumbnails
            const numThumbs = $('#thumbs').children().length;
            const newNumThumbs = cols * rows;
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
                updateThumbImage(i, image);
            }
            
            // Set the thumbnails' sizes
            $('#thumbs').children()
                .attr('width', size)
                .attr('height', size)
                .attr('class', 'thumb');
            $('#thumbs img:nth-child(' + cols + 'n)')
                .attr('width', sizeEnd)
                .attr('height', size)
                .attr('class', 'thumb-end');
        }
    }
    resize();
    new ResizeObserver(resize).observe(thumbContainer.get(0));
    
    // Listen for changes in the gallery view to apply them to the thumbnails
    gallery.addEventListener('change', (event) =>
    {
        // Find the range of changed images that are currently represented by thumbnails
        const minThumb = cols * virtualRow;
        const maxThumb = minThumb + $('#thumbs').children().length - 1;
        const minIndex = Math.max(minThumb, event.minIndex) - minThumb;
        const maxIndex = Math.min(maxThumb, event.maxIndex) - minThumb;
        for (let i = minIndex; i <= maxIndex; i++)
        {
            updateThumbImage(i);
        }
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
    scroll.update(dt, minScroll, maxScroll);
    const oldVirtualRow = virtualRow;
    const scrollClamped = Math.min(maxScroll, Math.max(minScroll, scroll.x));
    virtualRow = Math.floor(scrollClamped / size);

    // Update the thumb images if necessary
    if (virtualRow !== oldVirtualRow)
    {
        $('#thumbs').children().each((index, element) =>
        {
            const imageIndex = virtualRow * cols + index;
            updateThumbImage(imageIndex, $(element));
        });
    }

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