//live-network suites: the six exchanges and the end-to-end matrix
module.exports = {
    testMatch: ['<rootDir>/test/index.test.js', '<rootDir>/test/*-price-provider.test.js'],
    testPathIgnorePatterns: ['/node_modules/']
}
