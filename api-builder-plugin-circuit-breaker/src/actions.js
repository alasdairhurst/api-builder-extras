const NodeCache = require( "node-cache" );

/**
 * Action method.
 *
 * @param {object} params - A map of all the parameters passed from the flow.
 * @param {object} options - The additional options provided from the flow
 *	 engine.
 * @param {object} options.pluginConfig - The service configuration for this
 *	 plugin from API Builder config.pluginConfig['api-builder-plugin-pluginName']
 * @param {object} options.logger - The API Builder logger which can be used
 *	 to log messages to the console. When run in unit-tests, the messages are
 *	 not logged.  If you wish to test logging, you will need to create a
 *	 mocked logger (e.g. using `simple-mock`) and override in
 *	 `MockRuntime.loadPlugin`.  For more information about the logger, see:
 *	 https://docs.axway.com/bundle/API_Builder_4x_allOS_en/page/logging.html
 * @param {*} [options.pluginContext] - The data provided by passing the
 *	 context to `sdk.load(file, actions, { pluginContext })` in `getPlugin`
 *	 in `index.js`.
 * @return {*} The response value (resolves to "next" output, or if the method
 *	 does not define "next", the first defined output).
 */
async function configCheckCircuitBreaker(params, options) {
	const { circuitBreakerId } = params;
	const { logger, setOutput } = options;
	if (!circuitBreakerId) {
		throw new Error('Missing required parameter: circuitBreakerId');
	}
	const circuitBreakerCache = options.pluginContext.circuitBreakerCache;
	let circuitBreaker = circuitBreakerCache.get( circuitBreakerId );
	// Create a new Circuit-Breaker if not yet defined
	if(circuitBreaker == undefined) {
		logger.info(`New circuit breaker with ID: ${circuitBreakerId} initialized.`);
		circuitBreaker = {status: 'closed', output: 'next', errors: [], successCount: 0, errorCodeMap: {}, params};
		_setDefaultParams(circuitBreaker);
		circuitBreakerCache.set( circuitBreakerId, circuitBreaker);
	}
	logger.debug(`Circuit-Breaker: ${circuitBreakerId},  status: ${circuitBreaker.status}, Errors: ${circuitBreaker.errors.length}, successCount: ${circuitBreaker.successCount}`);
	switch (circuitBreaker.status) {
		case 'open':
			_handleOpenStatus(circuitBreaker, logger);
			break;
		case 'halfopen':
			_handleHalfopenStatus(circuitBreaker, logger);
			break;
		case 'closed':
			_handleClosedStatus(circuitBreaker, logger);
			break;
	}
	if(circuitBreaker.output == 'next') {
		return circuitBreaker;
	} else {
		return setOutput(circuitBreaker.output, circuitBreaker);
	}
}

async function updateCircuitBreaker(params, options) {
	const { circuitBreakerId, httpResponseCode } = params;
	const { logger } = options;
	if (!circuitBreakerId) {
		throw new Error('Missing required parameter: circuitBreakerId');
	}
	if (!httpResponseCode) {
		throw new Error('Missing required parameter: httpResponseCode');
	}
	const circuitBreakerCache = options.pluginContext.circuitBreakerCache;
	let circuitBreaker = circuitBreakerCache.get(circuitBreakerId);
	
	if(_isReturnCodeAnError(circuitBreaker, httpResponseCode, logger)) {
		const errorId = _getRandomId();
		circuitBreaker.errors.push({error: errorId, timestamp: new Date().getTime(), cause: `responseCode ${httpResponseCode}`});
		// If we encounter an error during Half/Open immediatly open the Ciruit-Breaker
		// Otherwise check the Error-Count
		if(circuitBreaker.status == 'halfopen' || circuitBreaker.errors.length>=circuitBreaker.params.maxErrorCount) {
			circuitBreaker.status = 'open';
			circuitBreaker.openedTimestamp = new Date().getTime();
		}
	} else {
		circuitBreaker.successCount++;
		logger.debug(`Increased successCount to ${circuitBreaker.successCount}`)
	}
	return circuitBreaker;
}

function _setDefaultParams(circuitBreaker) {
	var params = circuitBreaker.params;
	if(params.maxErrorCount == undefined)		params.maxErrorCount = 10;
	if(params.timeRange == undefined) 			params.timeRange = 300;
	if(params.halfOpenSuccesses == undefined) 	params.halfOpenSuccesses = 5;
	if(params.recoverPeriod == undefined) 		params.recoverPeriod = 30;
	if(params.communicationError == undefined) 	params.communicationError = true;
	if(params.returnCodes == undefined) 		params.returnCodes = "[300-999]";
	if(params.maxResponseTime == undefined) 	params.maxResponseTime = 100;
}

function _handleOpenStatus(circuitBreaker, logger) {
	// If Circuit-Breaker is OPEN ...
	circuitBreaker.output = 'open';
	// Perhaps we can already change to Half/Open status
	const recoverPeriod = circuitBreaker.params.recoverPeriod * 1000;
	if(circuitBreaker.openedTimestamp < new Date().getTime()-recoverPeriod) {
		logger.debug(`Switching Circuit-Breaker: ${circuitBreaker.params.circuitBreakerId} to half-open.`);
		circuitBreaker.status = 'halfopen';
		circuitBreaker.successCount = 0;
		return _handleHalfopenStatus(circuitBreaker);
	}
	// Only, when status is open remove potentially outdated errors before going further on
	circuitBreaker.errors.forEach(function(error, index, object) {
		const timeRange = new Date().getTime()-circuitBreaker.params.timeRange*1000
		if (error.timestamp < timeRange) {
			logger.debug(`Removing expired error: ${error.timestamp} vs. timeRangeStart: ${timeRange} (Cause: ${error.cause})`);
			object.splice(index);
		}
	});
	// Re-Check the number of errors after removing potentially outdated errors
	if(circuitBreaker.errors.length<circuitBreaker.params.maxErrorCount) {
		logger.debug(`Closing circuit-breaker errors.length ${circuitBreaker.errors.length} as it is below maxErrorCount: ${circuitBreaker.params.maxErrorCount}`);
		circuitBreaker.status = 'closed';
		circuitBreaker.output = 'next';
	}
	return;
}

function _handleHalfopenStatus(circuitBreaker, logger) {
	// If Circuit-Breaker is HALFOPEN ...
	// When halfopen - we may go open or closed path
	if(circuitBreaker.successCount % 2 == 0) {
		circuitBreaker.output = 'next';
	} else {
		circuitBreaker.output = 'open';
	}
	if(circuitBreaker.successCount>=circuitBreaker.params.halfOpenSuccesses) {
		logger.debug(`Switching Circuit-Breaker: ${circuitBreaker.params.circuitBreakerId} to closed as successCount: ${circuitBreaker.successCount}>=halfOpenSuccesses: ${circuitBreaker.params.halfOpenSuccesses}.`);
		circuitBreaker.status = 'closed';
		circuitBreaker.output = 'next';
		circuitBreaker.errors = [];
	}
	return;
}

function _handleClosedStatus(circuitBreaker, logger) {
	// If Circuit-Breaker is CLOSED ...
	circuitBreaker.output = 'next';
}

function _isReturnCodeAnError(circuitBreaker, httpResponseCode, logger) {
	if(httpResponseCode == undefined) return false;
	// Lookup the Error-Code
	if(circuitBreaker.errorCodeMap[httpResponseCode] != undefined) {
		return circuitBreaker.errorCodeMap[httpResponseCode];
	}
	const errorCodes = circuitBreaker.params.returnCodes;
	let fields = errorCodes.split(',');
	var result = false;
	for (var i = 0; i < fields.length; ++i) {
		var element = fields[i].trim();
		if(element.includes("-")) {
			let startEnd = element.replace(/\[|\]/g, "");
			startEnd = startEnd.split('-');
			if(httpResponseCode >= startEnd[0].trim() && httpResponseCode <= startEnd[1].trim()) {
				result = true;
				break;
			}
		// Specific HTTP-Codes 501, 401
		} else {
			if(httpResponseCode==element) {
				result = true;
				break;
			}
		}
	}
	// Remember the result of this Error-Code for the next run
	circuitBreaker.errorCodeMap[httpResponseCode] = result;
	return result;
}

function _getRandomId() {
	return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

module.exports = {
	configCheckCircuitBreaker, 
	updateCircuitBreaker
};
