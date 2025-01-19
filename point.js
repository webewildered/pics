// 2D point with arithmetic functions that can take another Point or a Number
export default class Point
{
    constructor(x = 0, y = x)
    {
        this.x = x;
        this.y = y;
    }
    
    get array() { return [this.x, this.y]; }

    unary(f)
    {
        return new Point(f(this.x), f(this.y));
    }

    binary(point, f)
    {
        if (typeof point === 'number')
        {
            point = new Point(point);
        }
        return new Point(f(this.x, point.x), f(this.y, point.y));
    }

    add(point) { return this.binary(point, (a, b) => a + b); }
    sub(point) { return this.binary(point, (a, b) => a - b); }
    mul(point) { return this.binary(point, (a, b) => a * b); }
    div(point) { return this.binary(point, (a, b) => a / b); }
    min(point) { return this.binary(point, (a, b) => Math.min(a, b)); }
    max(point) { return this.binary(point, (a, b) => Math.max(a, b)); }
    dot(point) { return this.mul(point).sum(); }
    abs() { return this.unary((a) => Math.abs(a)); }
    neg() { return this.unary((a) => -a); }
    sign() { return this.unary((a) => Math.sign(a)); }
    floor() { return this.unary((a) => Math.floor(a)); }
    ceil() { return this.unary((a) => Math.ceil(a)); }
    round() { return this.unary((a) => Math.round(a)); }
    sum() { return this.x + this.y; }
    distanceSquared(point) { return this.sub(point).lengthSquared(); }
    distance(point) { return Math.sqrt(this.distanceSquared(point)); }
    lengthSquared() { return this.dot(this); }
    length() { return Math.sqrt(this.lengthSquared()); }
    norm()
    {
        let l = this.length();
        if (l === 0)
        {
            return Point.zero;
        }
        return this.mul(new Point(1 / l));
    }

    greaterEqual(point)
    {
        return this.x >= point.x && this.y >= point.y;
    }

    equal(point)
    {
        return this.x === point.x && this.y === point.y;
    }

    clone()
    {
        return new Point(this.x, this.y);
    }

    toString()
    {
        return '(' + this.x + ', ' + this.y + ')';
    }
}