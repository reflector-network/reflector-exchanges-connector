class Asset {
    /**
     * @param {string} name - asset name
     * @param {string[]} alias - asset alias
     */
    constructor(name, alias) {
        this.name = name
        this.alias = alias
        if (this.alias.indexOf(this.name) < 0)
            this.alias.push(this.name)
    }

    /**
     * @type {string}
     * @readonly
     */
    name
    /**
     * @type {string[]}
     * @readonly
     */
    alias
}

module.exports = Asset