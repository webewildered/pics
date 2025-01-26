import Point from './point.js';

class FeelEvent extends Event
{
    constructor(name, touches, change)
    {
        super(name);
        this.touches = touches;
        this.change = change;
        this.rejected = false;
    }

    reject()
    {
        this.rejected = true;
    }
}

class FeelTouch
{
    constructor(identifier, pos)
    {
        this.identifier = identifier;
        this.pos = pos;
        this.origin = pos;
        this.last = pos;
    }
}

export default class Feeler extends EventTarget
{
    constructor(element)
    {
        super();
        this.touches = [];
        
        element.addEventListener('touchstart', (event) =>
        {
            console.log('start ' + element.id);
            for (const eventTouch of event.changedTouches)
            {
                const touch = new FeelTouch(eventTouch.identifier, new Point(eventTouch.clientX, eventTouch.clientY));
                const event = new FeelEvent('start', this.touches, touch);
                this.dispatchEvent(event);
                if (!event.rejected)
                {
                    this.touches.push(touch);
                }
            }
            event.preventDefault();
        });

        element.addEventListener('touchend', (event) =>
        {
            console.log('end ' + element.id);
            for (const eventTouch of event.changedTouches)
            {
                let touchIndex = this.getTouchIndex(eventTouch);
                if (touchIndex >= 0)
                {
                    this.dispatchEvent(new FeelEvent('end', this.touches, this.touches[touchIndex]));
                    this.touches.splice(touchIndex, 1);
                }
            }
            event.preventDefault();
        });
        
        element.addEventListener('touchmove', (event) =>
        {
            for (const touch of this.touches)
            {
                touch.last = touch.pos;
            }
            for (const eventTouch of event.changedTouches)
            {
                const touch = this.getTouch(eventTouch);
                if (touch)
                {
                    touch.pos = new Point(eventTouch.clientX, eventTouch.clientY);
                }
            }
            this.dispatchEvent(new FeelEvent('move', this.touches));
            event.preventDefault();
        });
    }

    //
    // Touch list lookup and management
    //
    
    getTouchIndex(eventTouch)
    {
        for (let i = 0; i < this.touches.length; i++)
        {
            if (this.touches[i].identifier === eventTouch.identifier)
            {
                return i;
            }
        }
        return -1;
    }

    getTouch(eventTouch)
    {
        let touchIndex = this.getTouchIndex(eventTouch);
        return (touchIndex >= 0) ? this.touches[touchIndex] : null;
    }

    //
    // Simple reusable input types
    //

    // Disable touch input
    static disable(element)
    {
        new Feeler(element).addEventListener('start', (event) =>
        {
            event.reject();
        });
    }

    // Calls callback whenever the element is tapped or clicked
    static tap(element, callback, withClick = true)
    {
        // Click
        if (withClick)
        {
            element.onclick = (event) =>
            {
                callback(event);
            }
        }

        // Tap
        const feeler = new Feeler(element);
        let down = false;
        feeler.addEventListener('start', (event) =>
        {
            if (event.touches.length)
            {
                down = false;
                event.reject();
            }
            else
            {
                down = true;
            }
        });
        feeler.addEventListener('end', (event) =>
        {
            if (down)
            {
                callback(event);
            }
        });
        feeler.addEventListener('move', () => down = false);
    }
}
