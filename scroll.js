// Animated scrolling. Supports mousewheel style with simple animated movement, and touch style with momentum and soft limits.
export default class Scroll
{
    constructor()
    {
        // position and velocity
        this.x = 0;
        this.v = 0;

        // target position
        this.target = 0;

        // if true, animate towards target, ignoring velocity
        this.animate = false;

        // if true, follow the target exactly. Ignored in animate mode.
        this.touch = false;
    }

    update(dt, minScroll, maxScroll)
    {
        if (this.animate)
        {
            // PC mode: Clamp and animate to the scroll target
            this.target = Math.min(Math.max(this.target, minScroll), maxScroll);
            this.x = this.target - (this.target - this.x) * Math.pow(0.0000001, dt);
        }
        else
        {
            // Calculate distance past the scroll boundary
            let calcOverScroll = (x) => Math.min(0, x - minScroll) + Math.max(0, x - maxScroll);
    
            // Touch mode
            if (this.touch)
            {
                // Finger down:
                // Within bounds, track the finger movement directly.
                // Out of bounds, lag behind, simulating a force pulling back towards the bounds.
                let overScroll = calcOverScroll(this.target);
                let x2 = this.target;
                if (overScroll != 0)
                {
                    x2 = x2 - overScroll + Math.pow(Math.abs(overScroll), 0.8) * Math.sign(overScroll);
                }
                this.v = (x2 - this.x) / dt;
                this.x = x2;
            }
            else
            {
                // Finger released
                let overScroll = calcOverScroll(this.x);
                if (overScroll == 0)
                {
                    // Within bounds, damp velocity
                    this.v *= Math.pow(0.1, dt);
                }
                else
                {
                    // Out of bounds, pull toward the bounds with a critically damped spring
                    const w = 5; // angular frequency
                    this.v = (this.v - dt * w * w * overScroll) / (1 + 2 * dt * w + dt * dt * w * w); // implicit integration
                }

                this.x += this.v * dt;
            }
        }
    }
}