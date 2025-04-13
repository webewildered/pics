export default class Album extends EventTarget
{
    constructor()
    {
        super();
        this.objects = [];
        this.view = [];
    }

    // Loads the album with the given key. Returns a promise that resolves when the load is complete.
    load(key)
    {
        this.key = key;

        const loadJson = (key) =>
        {
            return fetch('albums/' + key + '.json')
                .then((response) => response.json())
        }

        const loadAlbum = (album) =>
        {
            this.name = album.name;
            this.objects = album.objects;
            for (const object of this.objects)
            {
                this.#toRuntime(object);
            }
            this.view = [...this.objects];
            this.view.sort((a, b) => a.date - b.date);
            this.#dispatchChange(0, this.view.length - 1);
        }

        return loadJson(key)
            .then((json) =>
            {
                // Could be either an album or a collection
                if (json.main)
                {
                    // Collection. Can use the key to modify the album
                    this.collectionKey = key;
    
                    // Still need to load the album itself
                    this.key = json.main;
                    return loadJson(this.key).then((json) => { loadAlbum(json) })
                }
                else
                {
                    return loadAlbum(json);
                }
            });
    }

    add(object)
    {
        // Add to the object set
        this.#toRuntime(object);
        this.objects.push(object);

        // Add to the view
        let left = 0, right = this.view.length - 1;
        while (left <= right)
        {
            let mid = Math.floor((left + right) / 2);
            if (this.view[mid].date < object.date)
            {
                left = mid + 1;
            } else {
                right = mid - 1;
            }
        }
        this.view.splice(left, 0, object);
        this.#dispatchChange(left, this.view.length - 1);
    }

    remove(index)
    {
        const object = this.view[index];

        const event = new Event('remove');
        event.index = index;
        this.dispatchEvent(event);

        this.objects.splice(this.objects.indexOf(this.view[index]), 1);
        this.view.splice(index, 1);
        this.#dispatchChange(index, this.view.length);

        const reqBody = {collectionKey: this.collectionKey, file: object.file};
        fetch('api/deleteObject', { method: 'POST', body: JSON.stringify(reqBody) })
            .then((response) =>
            {
                if (response.status === 200)
                {
                    console.log('deleted ' + object.file);
                }
                else
                {
                    response.text().then((text) => { console.log('failed to delete ' + object.file + ': ' + text); });
                }
            });
    }

    // Converts an object loaded from json to one that's ready to use at runtime
    #toRuntime(object)
    {
        object.date = new Date(object.date);
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