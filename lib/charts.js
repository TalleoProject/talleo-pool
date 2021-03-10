var fs = require('fs');
var async = require('async');
var http = require('http');
var apiInterfaces = require('./apiInterfaces.js')(config.daemon, config.wallet, config.api);
var utils = require('./utils.js');

var logSystem = 'charts';
require('./exceptionWriter.js')(logSystem);

log('info', logSystem, 'Started');

function startDataCollectors() {
    async.each(Object.keys(config.charts.pool), function(chartName) {
        var settings = config.charts.pool[chartName];
        if(settings.enabled) {
            setInterval(function() {
                collectPoolStatWithInterval(chartName, settings);
            }, settings.updateInterval * 1000);
        }
    });

    var settings = config.charts.user.hashrate;
    if(settings.enabled) {
        setInterval(function() {
            collectUsersHashrate('hashrate', settings);
        }, settings.updateInterval * 1000)
    }
}

function compareResponses(a, b) {
    if (a[0] < b[0]) {
        return -1;
    }
    if (a[0] > b[0]) {
        return 1;
    }
    return 0;
}

function getChartDataFromRedis(chartName, callback) {
    redisClient.keys(getStatsRedisKey(chartName), function(error, data) {

        redisClient.mget(data, function(error, data) {
            var chartsResponses = [];
            if (data !== undefined) {
                var i;
                for (i = 0; i < data.length; i++) {
                    var d = JSON.parse(data[i]);
                    for (var j = 0; j < d.length; j++) {
                        chartsResponses.push(d[j]);
                    }
                }
                chartsResponses.sort(compareResponses);
                if (chartName.substring(0, 8) == 'hashrate' && chartName.substr(-1) == '*') {
                    var dateNowSeconds = Math.floor(Date.now() / 1000);
                    var minTime = dateNowSeconds - config.charts.user.hashrate.maximumPeriod + 1;
                    while (chartsResponses.length > 0 && chartsResponses[0][0] < minTime) {
                         chartsResponses.shift();
                    }
                    for (i = 0; i < chartsResponses.length - 1; i++) {
                        var interval = config.charts.user.hashrate.stepInterval;
                        while (chartsResponses[i + 1][0] < chartsResponses[i][0]) {
                            var tmp = chartsResponses[i];
                            chartsResponses[i] = chartsResponses[i + 1];
                            chartsResponses[i + 1] = tmp;
                            i--;
                            if (i < 0) {
                                i = 0;
                                break;
                            }
                        }
                        var maxTime = chartsResponses[i][0] + interval;
                        if (chartsResponses[i + 1][0] < maxTime) {
                            var diff1 = maxTime - chartsResponses[i + 1][0];
                            var diff2 = interval - diff1;
                            chartsResponses[i][1] += Math.floor(chartsResponses[i + 1][1] * (diff1 / interval));
                            chartsResponses[i][2] += Math.floor(chartsResponses[i + 1][2] * (diff1 / interval));
                            chartsResponses[i + 1][0] = chartsResponses[i][0] + interval;
                            chartsResponses[i + 1][1] = Math.floor(chartsResponses[i + 1][1] * (diff2 / interval));
                            chartsResponses[i + 1][2] = Math.floor(chartsResponses[i + 1][2] * (diff2 / interval));
                        }
                    }
                    while (chartsResponses.length > 0 && chartsResponses[chartsResponses.length - 1][0] > dateNowSeconds) {
                        chartsResponses.pop();
                    }
                }
            }
            callback(chartsResponses ? chartsResponses : []);
        });
    });
}

function getUserHashrateChartData(address, callback) {
    getChartDataFromRedis('hashrate:' + address + "*", callback);
}

function convertPaymentsDataToChart(paymentsData) {
    var data = [];
    if(paymentsData && paymentsData.length) {
        for(var i = 0; paymentsData[i]; i += 2) {
            data.unshift([+paymentsData[i + 1], paymentsData[i].split(':')[1]]);
        }
    }
    return data;
}

function convertBlocksDataToChart(blocksData) {
    var data = [];
    for (var blocks in blocksData) {
        data.push([new Date(blocks).getTime() / 1000, blocksData[blocks]]);
    }
    return data;
}

async function getBlockSolver(height) {
    var promise = new Promise((resolve, reject) =>
        redisClient.get(config.coin + ':solver:round' + height, function(error, result){
            if (error){
                log('error', logSystem, 'Error with fetching wallet address for miner who solved block %j', [error]);
                reject(new Error(error));
            } else {
                resolve(result);
            }
        })
    );
    return await promise;
}

function getUserChartsData(address, paymentsData, callback) {
    var stats = {};
    var chartsFuncs = {
        hashrate: function(callback) {
            getUserHashrateChartData(address, function(data) {
                callback(null, data);
            });
        },

        payments: function(callback) {
            callback(null, convertPaymentsDataToChart(paymentsData));
        },

        blocks: function(callback) {
            // Get enabled charts data
            getPoolChartsData(function(error, data) {
                if (error) {
                    callback(error, data);
                    return;
                }

                // Blocks chart
                if (!config.charts.blocks || !config.charts.blocks.enabled || !config.charts.blocks.days) {
                    callback(error, data);
                    return;
                }

                var chartDays = config.charts.blocks.days;

                var beginAtTimestamp = (Date.now() / 1000) - (chartDays * 86400);
                var beginAtDate = new Date(beginAtTimestamp * 1000);
                if (chartDays > 1) {
                    beginAtDate = new Date(beginAtDate.getFullYear(), beginAtDate.getMonth(), beginAtDate.getDate(), 0, 0, 0, 0);
                    beginAtTimestamp = beginAtDate / 1000 | 0;
                }

                var maxBlocks = 86400 / config.coinDifficultyTarget * (chartDays + 1);
                redisClient.zrevrange(config.coin + ':blocks:matured', 0, maxBlocks, 'WITHSCORES', async function(err, result) {
                    let blocksCount = {};
                    if (chartDays === 1) {
                        for (var h = 0; h <= 24; h++) {
                            var date = utils.dateFormat(new Date((beginAtTimestamp + (h * 60 * 60)) * 1000), 'yyyy-mm-dd HH:00');
                            blocksCount[date] = 0;
                        }
                    } else {
                        for (var d = 0; d <= chartDays; d++) {
                            var date = utils.dateFormat(new Date((beginAtTimestamp + (d * 86400)) * 1000), 'yyyy-mm-dd');
                            blocksCount[date] = 0;
                        }
                    }

                    for (var i = 0; i < result.length; i+=2){
                        var block = result[i].split(':');
                        var blockHeight = result[i+1];
                        var blockTimestamp = block[1];
                        if (blockTimestamp < beginAtTimestamp) {
                            break;
                        }
                        var solver = await getBlockSolver(blockHeight);
                        if (solver == address) {
                            var date = utils.dateFormat(new Date(blockTimestamp * 1000), 'yyyy-mm-dd');
                            if (chartDays === 1) date = utils.dateFormat(new Date(blockTimestamp * 1000), 'yyyy-mm-dd HH:00');
                            if (!blocksCount[date]) blocksCount[date] = 0;
                            blocksCount[date] ++;
                        }
                    }
                    callback(error, convertBlocksDataToChart(blocksCount));
                });
            });
        }
    };
    for(var chartName in chartsFuncs) {
        if(!config.charts.user[chartName].enabled) {
            delete chartsFuncs[chartName];
        }
    }
    async.parallel(chartsFuncs, callback);
}

function getStatsRedisKey(chartName) {
    return config.coin + ':charts:' + chartName;
}

var chartStatFuncs = {
    hashrate: getPoolHashrate,
    workers: getPoolWorkers,
    miners: getPoolMiners,
    difficulty: getNetworkDifficulty,
    price: getCoinPrice,
    profit: getCoinProfit
};

var statValueHandler = {
    avg: function(set, value) {
        set[1] = (set[1] * set[2] + value) / (set[2] + 1);
    },
    avgRound: function(set, value) {
        statValueHandler.avg(set, value);
        set[1] = Math.round(set[1]);
    },
    max: function(set, value) {
        if(value > set[1]) {
            set[1] = value;
        }
    }
};

var preSaveFunctions = {
    hashrate: statValueHandler.avgRound,
    workers: statValueHandler.max,
    miners: statValueHandler.max,
    difficulty: statValueHandler.avgRound,
    price: statValueHandler.avg,
    profit: statValueHandler.avg
};

function storeCollectedValues(chartName, values, settings) {
    for(var i in values) {
        storeCollectedValue(chartName + ':' + i, values[i], settings);
    }
}

function storeCollectedValue(chartName, value, settings) {
    var now = new Date() / 1000 | 0;
    getChartDataFromRedis(chartName, function(sets) {
        var lastSet = sets[sets.length - 1]; // [time, avgValue, updatesCount]
        if(!lastSet || now - lastSet[0] > settings.stepInterval) {
            lastSet = [now, value, 1];
            sets.push(lastSet);
            while(now - sets[0][0] > settings.maximumPeriod) { // clear old sets
                sets.shift();
            }
        }
        else {
            preSaveFunctions[chartName]
                ? preSaveFunctions[chartName](lastSet, value)
                : statValueHandler.avgRound(lastSet, value);
            lastSet[2]++;
        }
        redisClient.set(getStatsRedisKey(chartName), JSON.stringify(sets));
        log('info', logSystem, chartName + ' chart collected value ' + value + '. Total sets count ' + sets.length);
    });
}

function collectPoolStatWithInterval(chartName, settings) {
    async.waterfall([
        chartStatFuncs[chartName],
        function(value, callback) {
            storeCollectedValue(chartName, value, settings, callback);
        }
    ]);
}

function getPoolStats(callback) {
    apiInterfaces.pool('/stats', callback);
}

function getPoolHashrate(callback) {
    getPoolStats(function(error, stats) {
        callback(error, stats.pool ? Math.round(stats.pool.hashrate) : null);
    });
}

function getPoolWorkers(callback) {
    getPoolStats(function(error, stats) {
        callback(error, stats.pool ? stats.pool.workers : null);
    });
}

function getPoolMiners(callback) {
    getPoolStats(function(error, stats) {
        callback(error, stats.pool ? stats.pool.miners : null);
    });
}

function getNetworkDifficulty(callback) {
    getPoolStats(function(error, stats) {
        callback(error, stats.pool ? stats.network.difficulty : null);
    });
}

function getUsersHashrates(callback) {
    var method = '/miners_hashrate?password=' + config.api.password;
    apiInterfaces.pool(method, function(error, data) {
        callback(data.minersHashrate);
    });
}

function collectUsersHashrate(chartName, settings) {
    var redisBaseKey = getStatsRedisKey(chartName) + ':';
    redisClient.keys(redisBaseKey + '*', function(keys) {
        var hashrates = {};
        for(var i in keys) {
            hashrates[keys[i].substr(keys[i].length)] = 0;
        }
        getUsersHashrates(function(newHashrates) {
            for(var address in newHashrates) {
                hashrates[address] = newHashrates[address];
            }
            storeCollectedValues(chartName, hashrates, settings);
        });
    });
}

function getCoinPrice(callback) {
    apiInterfaces.jsonHttpRequest('api.cryptonator.com', 443, '', function(error, response) {
        callback((response && response.error) ? response.error : error, (response && response.success) ? +response.ticker.price : null);
    }, '/api/ticker/' + config.symbol.toLowerCase() + '-usd');
}

function getCoinProfit(callback) {
    getCoinPrice(function(error, price) {
        if(error) {
            callback(error);
            return;
        }
        getPoolStats(function(error, stats) {
            if(error) {
                callback(error);
                return;
            }
            callback(null, stats.network.reward * price / stats.network.difficulty / config.coinUnits);
        });
    });
}

function getPoolChartsData(callback) {
    var chartsNames = [];
    var redisKeys = [];
    for(var chartName in config.charts.pool) {
        if(config.charts.pool[chartName].enabled) {
            chartsNames.push(chartName);
            redisKeys.push(getStatsRedisKey(chartName));
        }
    }
    if(redisKeys.length) {
        redisClient.mget(redisKeys, function(error, data) {
            var stats = {};
            if(data) {
                for(var i in data) {
                    if(data[i]) {
                        stats[chartsNames[i]] = JSON.parse(data[i]);
                    }
                }
            }
            callback(error, stats);
        });
    }
    else {
        callback(null, {});
    }
}

module.exports = {
    startDataCollectors: startDataCollectors,
    getUserChartsData: getUserChartsData,
    getPoolChartsData: getPoolChartsData
};
