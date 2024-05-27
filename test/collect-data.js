const fs = require('fs')
const createCsvWriter = require('csv-writer').createObjectCsvWriter
const {getOHLCVs} = require('../src')
const {assets} = require('./test-utils')


function normalizeTimestamp(timestamp, timeframe) {
    return Math.floor(timestamp / timeframe) * timeframe
}

async function run() {
    const now = Date.now()
    const timeframe = 60000
    const delay = 30000
    let timestamp = normalizeTimestamp(now, timeframe) - timeframe
    const dataDir = 'test/data'
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir)
    }
    const providers = ['binance', 'bybit', 'coinbase', 'gate', 'kraken', 'okx']
    const headers = [{id: 'timestamp', title: 'TIMESTAMP'}]
    const writers = {}
    for (const provider of providers) {
        headers.push({id: provider, title: provider.toLocaleUpperCase()})
    }
    for (const asset of assets) {
        const csvWriter = createCsvWriter({
            path: `${dataDir}/${asset}.csv`,
            header: headers
        })
        writers[asset] = csvWriter
    }
    const getPricesWorker = async () => {
        try {
            if (timestamp + timeframe + delay > Date.now())
                await new Promise(resolve => setTimeout(resolve, timestamp + timeframe + delay - Date.now()))
            console.log(`Getting price for: ${new Date(timestamp).toISOString()} at ${new Date().toISOString()}`)
            const ohlcvs = await getOHLCVs(providers, assets, 'USD', timestamp / 1000, 60, 14)
            for (const asset of assets) {
                const row = {timestamp}
                const assetOhlcvs = ohlcvs[asset]
                if (!assetOhlcvs)
                    continue
                for (const ohlcv of assetOhlcvs) {
                    row[ohlcv.source] = ohlcv.price().toString()
                }
                await writers[asset].writeRecords([row])
            }
        } catch (error) {
            console.error(error)
        } finally {
            timestamp += timeframe
            setTimeout(getPricesWorker, timestamp + timeframe + delay - Date.now())
        }
    }

    await getPricesWorker()
}

run()