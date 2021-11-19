function getReadableHashRateString(hashrate){
    hashrate = parseFloat(hashrate || 0);
    if (hashrate < 1000) return hashrate.toFixed(0) + ' H/s';
    var i = 0;
    var byteUnits = [' H/s', ' kH/s', ' MH/s', ' GH/s', ' TH/s', ' PH/s'];
    while (hashrate > 1000){
        hashrate = hashrate / 1000;
        i++;
    }
    return hashrate.toFixed(3) + byteUnits[i];
}

function getReadableSizeString(size){
    var i = 0;
    var byteUnits = [' B', ' kB', ' MB', ' GB', ' TB', ' PB'];
    while (size > 1024){
        size = size / 1024;
        i++;
    }
    return size.toFixed(2) + byteUnits[i];
}

function getReadableDifficultyString(difficulty){
    if (difficulty < 1000) return difficulty.toString();
    var i = 0;
    var byteUnits = [' ', ' k', ' M', ' G', ' T', ' P'];
    while (difficulty > 1000){
        difficulty = difficulty / 1000;
        i++;
    }
    return difficulty.toFixed(2) + byteUnits[i];
}

function getReadableHashesString(hashes){
    if (hashes < 1000) return hashes.toString() + ' H';
    var i = 0;
    var byteUnits = [' H', ' kH', ' MH', ' GH', ' TH', ' PH'];
    while (hashes > 1000){
        hashes = hashes / 1000;
        i++;
    }
    return hashes.toFixed(3) + byteUnits[i];
}

function getReadableTime(seconds){
    var units = [ [60, ['second', 'seconds']], [60, ['minute', 'minutes']], [24, ['hour', 'hours']], [7, ['day', 'days']], [(365/84), ['week', 'weeks']],
                  [12, ['month', 'months']], [10, ['year', 'years']], [10, ['decade', 'decades']], [10, ['century', 'centuries']], [1, ['millenium', 'millenia']] ];

    function formatAmounts(amount, unit){
        var rounded = Math.floor(amount);
        return '' + rounded + ' ' + (rounded > 1 ? unit[1] : unit[0]);
    }

    var amount = seconds;
    var amount2 = 0;
    for (var i = 0; i < units.length; i++){
        if (amount < units[i][0]) {
            if (Math.floor(amount2) == 0) {
                return formatAmounts(amount, units[i][1]);
            } else {
                return formatAmounts(amount, units[i][1]) + " and " + formatAmounts(amount2, units[i-1][1]);
            }
        }
        if (units[i][0] != 1) {
            amount2 = amount % units[i][0];
            amount = amount / units[i][0];
        }
    }
    return formatAmounts(amount, units[units.length - 1][1]);
}

function getReadableCoins(coins, digits, withoutSymbol){
    var amount = (parseInt(coins || 0) / lastStats.config.coinUnits).toFixed(digits || lastStats.config.coinUnits.toString().length - 1);
    return amount + (withoutSymbol ? '' : (' ' + lastStats.config.symbol));
}

function getAverageDifficulty() {
    var avg = 0;
    var avgCount = 0;
    var beginAtTimestamp = new Date(Date.now() - 86400000);
    beginAtTimestamp = beginAtTimestamp / 1000 | 0;
    if (lastStats.charts.difficulty) {
        for (var i = 0; i < lastStats.charts.difficulty.length; i++) {
            if (lastStats.charts.difficulty[i][0] >= beginAtTimestamp) {
                avg += lastStats.charts.difficulty[i][1];
                avgCount++;
            }
        }
    }
    if (avgCount > 0) {
        avg /= avgCount;
    }
    return avg;
}

function getAverageHashrate(hashrates) {
    var avg = 0;
    var avgCount = 0;
    var beginAtTimestamp = new Date(Date.now() - 86400000);
    beginAtTimestamp = beginAtTimestamp / 1000 | 0;
    if (hashrates) {
        for (var i = 0; i < hashrates.length; i++) {
            if (hashrates[i][0] >= beginAtTimestamp) {
                avg += hashrates[i][1];
                avgCount++;
            }
        }
    }
    if (avgCount > 0) {
        avg /= avgCount;
    }
    return avg;
}
