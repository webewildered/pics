export default class Gallery extends EventTarget
{
    constructor()
    {
        super();
        this.images = [];
        this.view = [];
    }

    // Loads the gallery with the given key. Returns a promise that resolves when the load is complete.
    load(key)
    {
        this.key = key;

        const loadJson = (key) =>
        {
            return fetch('galleries/' + key + '.json')
                .then((response) => response.json())
        }

        const loadGallery = (gallery) =>
        {
            this.name = gallery.name;
            this.images = gallery.images;
            for (const image of this.images)
            {
                this.#toRuntime(image);
            }
            this.view = [...this.images];
            this.view.sort((a, b) => a.date - b.date);
            this.#dispatchChange(0, this.view.length - 1);
        }

        return loadJson(key)
            .then((json) =>
            {
                if (json.galleryKey)
                {
                    // Can use the key to modify the gallery
                    this.writeKey = key;
    
                    // Still need to load the gallery itself
                    this.key = json.galleryKey;
                    return loadJson(this.key).then((json) => { loadGallery(json) })
                }
                else
                {
                    return loadGallery(json);
                }
            });
    }

    add(image)
    {
        this.#toRuntime(image);
        this.images.push(image);
    }

    remove(index)
    {
        const event = new Event('remove');
        event.index = index;
        this.dispatchEvent(event);

        this.images.splice(this.images.indexOf(this.view[index]), 1);
        this.view.splice(index, 1);
        this.#dispatchChange(index, this.view.length);
    }

    // Converts an image entry loaded from json to one that's ready to use at runtime
    #toRuntime(image)
    {
        image.date = Date.parse(image.date);
    }

    // Fires an event that the view changed
    #dispatchChange(minIndex, maxIndex)
    {
        const event = new Event('change');
        event.minIndex = minIndex;
        event.maxIndex = maxIndex;
        this.dispatchEvent(event);
    }
}