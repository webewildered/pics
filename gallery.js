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
        // Add to the image set
        this.#toRuntime(image);
        this.images.push(image);

        // Add to the view
        let left = 0, right = this.view.length - 1;
        while (left <= right)
        {
            let mid = Math.floor((left + right) / 2);
            if (this.view[mid].date < image.date)
            {
                left = mid + 1;
            } else {
                right = mid - 1;
            }
        }
        this.view.splice(left, 0, image);
        this.#dispatchChange(left, this.view.length - 1);
    }

    remove(index)
    {
        const galleryEntry = this.view[index];

        const event = new Event('remove');
        event.index = index;
        this.dispatchEvent(event);

        this.images.splice(this.images.indexOf(this.view[index]), 1);
        this.view.splice(index, 1);
        this.#dispatchChange(index, this.view.length);

        const reqBody = {writeKey: this.writeKey, file: galleryEntry.file};
        fetch('api/deleteImage', { method: 'POST', body: JSON.stringify(reqBody) })
            .then((response) =>
            {
                if (response.status === 200)
                {
                    console.log('deleted ' + galleryEntry.file);
                }
                else
                {
                    response.text().then((text) => { console.log('failed to delete ' + galleryEntry.file + ': ' + text); });
                }
            });
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