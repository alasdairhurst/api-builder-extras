const { expect } = require('chai');
const { MockRuntime } = require('@axway/api-builder-test-utils');
const getPlugin = require('../src');

describe('flow-node circuit-breaker', () => {
	let plugin;
	let flowNode;
	beforeEach(async () => {
		plugin = await MockRuntime.loadPlugin(getPlugin);
		plugin.setOptions({ validateOutputs: true });
		flowNode = plugin.getFlowNode('circuit-breaker');
	});

	describe('#constructor', () => {
		it('should define flow-nodes', () => {
			expect(plugin).to.be.a('object');
			expect(plugin.getFlowNodeIds()).to.deep.equal([
				'circuit-breaker'
			]);
			expect(flowNode).to.be.a('object');

			expect(flowNode.name).to.equal('Circuit Breaker');
			expect(flowNode.description).to.equal('Adds a circuit breaker to your flow.');
			expect(flowNode.icon).to.be.a('string');
			expect(flowNode.getMethods()).to.deep.equal([
				'configCheckCircuitBreaker', 
				'updateCircuitBreaker'
			]);
		});

		it('should define valid flow-nodes', () => {
			plugin.validate();
		});
	});

	describe('#circuitBreaker', () => {
		it('configCheckCircuitBreaker should error when missing required parameter', async () => {
			const { value, output } = await flowNode.configCheckCircuitBreaker({
				circuitBreakerId: null
			});

			expect(value).to.be.instanceOf(Error)
				.and.to.have.property('message', 'Missing required parameter: circuitBreakerId');
			expect(output).to.equal('error');
		});

		it('updateCircuitBreaker should error when missing required parameter circuitBreakerId', async () => {
			const { value, output } = await flowNode.updateCircuitBreaker({
				circuitBreakerId: null, httpResponseCode: null
			});

			expect(value).to.be.instanceOf(Error)
				.and.to.have.property('message', 'Missing required parameter: circuitBreakerId');
			expect(output).to.equal('error');
		});

		it('should initialize a new Circuit-Breaker', async () => {
			const { value, output } = await flowNode.configCheckCircuitBreaker({ circuitBreakerId: 'newBreaker' });

			expect(value.status).to.equal('closed');
			expect(value.successCount).to.equal(0);
			expect(value.errors.length).to.equal(0);
			expect(value.params.circuitBreakerId).to.equal('newBreaker');
			// Check the default values 
			expect(value.params.timeRange).to.equal(300);
			expect(value.params.maxErrorCount).to.equal(10);
			expect(value.params.halfOpenSuccesses).to.equal(5);
			expect(value.params.recoverPeriod).to.equal(30);
			expect(value.params.communicationError).to.equal(true);
			expect(value.params.returnCodes).to.equal('[300-999]');
			expect(value.params.maxResponseTime).to.equal(100);
			expect(output).to.equal('next');
		});

		it('should not consider Errors recorded not within the given timerange', async () => {
			// This initializes a new Ciruit-Breaker with error count 0
			var { value, output } = await flowNode.configCheckCircuitBreaker({ 
				circuitBreakerId: 'errorMustDisappearBreaker', 
				returnCodes: '[300-900]', 
				maxErrorCount: 1, 
				timeRange: 3 // Recorded Errors should disappear after 3 seconds
			});

			expect(value.params.circuitBreakerId).to.equal('errorMustDisappearBreaker');
			expect(value.params.returnCodes).to.equal('[300-900]');
			expect(value.params.maxErrorCount).to.equal(1);
			// Make sure, defaults are still there
			expect(value.params.maxResponseTime).to.equal(100);
			expect(value.params.recoverPeriod).to.equal(30);
			expect(output).to.equal('next');

			// Force an Error which should disappear after the timerange
			var { value, output } = await flowNode.updateCircuitBreaker({  circuitBreakerId: 'errorMustDisappearBreaker', httpResponseCode: 500 });
			expect(output).to.equal('next');
			expect(value.status).to.equal('open');
			expect(value.errors.length).to.equal(1, 'Erros.length should be 1 after sending a 500 response');

			// Test time range - Wait the the configured time range
			await wait(4000);

			var { value, output } = await flowNode.configCheckCircuitBreaker({ circuitBreakerId: 'errorMustDisappearBreaker' });
			expect(output).to.equal('next');
			expect(value.status).to.equal('closed');
			expect(value.errors.length).to.equal(0, 'Error-Count must have reseted 0 as it is out of the configured timerange');

		}).timeout(10000);

		it('validate limetime behavior of the Circuit-Breaker', async () => {
			// This initializes a new Ciruit-Breaker with error count 0
			var { value, output } = await flowNode.configCheckCircuitBreaker({ 
				circuitBreakerId: 'lifetimeBreakerTest', 
				returnCodes: '[300-998]', 
				maxErrorCount: 2, 
				recoverPeriod: 3, // Circuit-Breaker should be half-open after 3 seconds during tests
				timeRange: 6, // Circuit-Breaker should be FULLY open after 6 seconds during tests
				halfOpenSuccesses: 3 // Number of request, that must be successful to leave the Half-Open state into Closed
			});
			expect(value.status).to.equal('closed');
			expect(value.successCount).to.equal(0);
			expect(value.errors.length).to.equal(0);
			expect(value.params.circuitBreakerId).to.equal('lifetimeBreakerTest');
			expect(value.params.returnCodes).to.equal('[300-998]');
			expect(value.params.maxErrorCount).to.equal(2);
			expect(value.params.recoverPeriod).to.equal(3);
			expect(value.params.timeRange).to.equal(6);
			expect(value.params.halfOpenSuccesses).to.equal(3);
			expect(output).to.equal('next');

			// Update circuit-breaker with a valid response - Should stay to error count 0
			var { value, output } = await flowNode.updateCircuitBreaker({ 
				circuitBreakerId: 'lifetimeBreakerTest', 
				httpResponseCode: 200
			});
			expect(output).to.equal('next');
			expect(value.status).to.equal('closed');
			expect(value.errors.length).to.equal(0, 'Error-Count must be 0 as the provided code was 200');

			// Update circuit breaker with a 500 response - errorCount should have increased to 1
			var { value, output } = await flowNode.updateCircuitBreaker({ 
				circuitBreakerId: 'lifetimeBreakerTest', 
				httpResponseCode: 500
			});
			expect(output).to.equal('next');
			expect(value.status).to.equal('closed');
			expect(value.errors.length).to.equal(1, 'Error-Count must be 1 as the provided code was 500');

			// Make sure, the Circuit-Breaker is NOT RE-INITIALIZED - It must stay with ErrorCount 1
			var { value, output } = await flowNode.configCheckCircuitBreaker({ circuitBreakerId: 'lifetimeBreakerTest' });
			expect(output).to.equal('next');
			expect(value.status).to.equal('closed');
			expect(value.errors.length).to.equal(1, 'Error-Count must stay 1 as the same CircuitBreakerID was used.');

			// Trigger another error to increase errorCount to 2 which must open the Ciruit-Breaker
			var { value, output } = await flowNode.updateCircuitBreaker({ 
				circuitBreakerId: 'lifetimeBreakerTest', 
				httpResponseCode: 401
			});
			expect(output).to.equal('next');
			expect(value.status).to.equal('open');
			expect(value.errors.length).to.equal(2, 'Error-Count must be 2 as the provided code was 401');

			// Circuit-Breaker is now OPEN, which must be honored by the configCheckCircuitBreaker method
			var { value, output } = await flowNode.configCheckCircuitBreaker({ circuitBreakerId: 'lifetimeBreakerTest' });
			expect(value.status).to.equal('open');
			expect(output).to.equal('open');
			expect(value.errors.length).to.equal(2, 'Error-Count must be 2, which means the circuit is open');

			// Test recovery period - Wait the recovery time
			await wait(4000);
			// Now status must have changed to half/open following the next path to give the service a try
			var { value, output } = await flowNode.configCheckCircuitBreaker({ circuitBreakerId: 'lifetimeBreakerTest' });
			expect(output).to.equal('next', 'Circuit-Breaker should follow the Next (Closed) path, even if Half/Open');
			expect(value.status).to.equal('halfopen');
			expect(value.successCount).to.equal(0, 'Success-Count must have been set to 0 as initial value');
			expect(value.errors.length).to.equal(2, 'Error-Count must still be 2, as the Circuit-Breaker is not fully open again');

			// Run another request during recovery, which succeeds and should increase the successCount to 1
			var { value, output } = await flowNode.updateCircuitBreaker({ circuitBreakerId: 'lifetimeBreakerTest', httpResponseCode: 200	});
			expect(output).to.equal('next');
			expect(value.status).to.equal('halfopen');
			expect(value.successCount).to.equal(1, 'Success-Count must have increased to 1');
			expect(value.errors.length).to.equal(2, 'Error-Count must stay to 2 as the provided code was 200');

			// Second validatation Circuit-Breaker during half open - This time, the path should be open
			var { value, output } = await flowNode.configCheckCircuitBreaker({ circuitBreakerId: 'lifetimeBreakerTest' });
			expect(output).to.equal('open', 'On the second Half/Open request the flow should follow the Open path');
			expect(value.status).to.equal('halfopen');
			expect(value.successCount).to.equal(1, 'Success-Count must stay at 1');
			expect(value.errors.length).to.equal(2, 'Error-Count must still be 2, as the Circuit-Breaker is not fully open again');

			// With this request the successCount is increased to 2 which should change the status to closed
			var { value, output } = await flowNode.updateCircuitBreaker({ circuitBreakerId: 'lifetimeBreakerTest', httpResponseCode: 200	});
			expect(output).to.equal('next');
			expect(value.status).to.equal('halfopen');
			expect(value.successCount).to.equal(2, 'Success-Count must have increased to 2 as the provided code was 200');
			expect(value.errors.length).to.equal(2, 'Error-Count must stay to 2 as the provided code was 200');

			// With this request the successCount is increased to 3 
			var { value, output } = await flowNode.updateCircuitBreaker({ circuitBreakerId: 'lifetimeBreakerTest', httpResponseCode: 200	});
			expect(output).to.equal('next');
			expect(value.status).to.equal('halfopen');
			expect(value.successCount).to.equal(3, 'Success-Count must have increased to 3 as the provided code was 200');
			expect(value.errors.length).to.equal(2, 'Error-Count must stay to 2 as the provided code was 200');

			// Validate the status is now Closed!
			var { value, output } = await flowNode.configCheckCircuitBreaker({ circuitBreakerId: 'lifetimeBreakerTest' });
			expect(output).to.equal('next', 'On the second Half/Open request the flow should follow the Open path');
			expect(value.status).to.equal('closed');
			expect(value.errors.length).to.equal(0, 'Error-Count have been reseted as it has left the Half/Open state.');

			// Sleep a few more seconds which must reset the errorCount to 0, as the timeRange is set to 5 seconds only
			/*
			await wait(7000);
			// Now the ErrorCount must be set to 0 and the status must be closed
			var { value, output } = await flowNode.configCheckCircuitBreaker({ circuitBreakerId: 'lifetimeBreakerTest' });
			expect(output).to.equal('next');
			expect(value.status).to.equal('closed');
			expect(value.errors.length).to.equal(0, 'Error-Count must be 0 as all Errors should have expireed, which means the circuit is open');*/
		}).timeout(13000);

		it('should reset the Circuit-Breaker to open - When Half-Open and an Error occurs', async () => {
			// This initializes a new Ciruit-Breaker with error count 0
			var { value, output } = await flowNode.configCheckCircuitBreaker({ 
				circuitBreakerId: 'resetToOpenBreaker', 
				returnCodes: '[300-999]', 
				maxErrorCount: 1, 
				recoverPeriod: 3, // Circuit-Breaker should be half-open after 3 seconds for these tests
				timeRange: 6, // Circuit-Breaker should be FULLY open after 6 seconds for these tests
				halfOpenSuccesses: 3 // Number of requests, that must be successful to leave the Half-Open state into Closed
			});

			expect(value.status).to.equal('closed');
			expect(value.successCount).to.equal(0);
			expect(value.errors.length).to.equal(0);
			expect(value.params.circuitBreakerId).to.equal('resetToOpenBreaker');
			expect(value.params.returnCodes).to.equal('[300-999]');
			expect(value.params.maxErrorCount).to.equal(1);
			expect(value.params.recoverPeriod).to.equal(3);
			expect(value.params.timeRange).to.equal(6);
			expect(value.params.halfOpenSuccesses).to.equal(3);
			expect(output).to.equal('next');

			// Force an Error which increases the error count and opens the Circuit-Breaker
			var { value, output } = await flowNode.updateCircuitBreaker({  circuitBreakerId: 'resetToOpenBreaker', httpResponseCode: 500 });
			expect(output).to.equal('next');
			expect(value.status).to.equal('open');
			expect(value.errors.length).to.equal(1, 'Errors.length should be 1 as the code 500 does fall into the range');

			// Wait the recovery time - To get status half/open state
			await wait(4000);
			// Now status must have changed to half/open following the next path to give the service a try
			var { value, output } = await flowNode.configCheckCircuitBreaker({ circuitBreakerId: 'resetToOpenBreaker' });
			expect(output).to.equal('next', 'Circuit-Breaker should follow the Next (Closed) path, even if Half/Open');
			expect(value.status).to.equal('halfopen');
			expect(value.successCount).to.equal(0, 'Success-Count must have been set to 0 as initial value');
			expect(value.errors.length).to.equal(1, 'Error-Count must still be 1, as the Circuit-Breaker is not fully open again');

			// Force a new Error during Half/Open status to fully re-open the Circuit-Breaker again
			var { value, output } = await flowNode.updateCircuitBreaker({  circuitBreakerId: 'resetToOpenBreaker', httpResponseCode: 403 });
			expect(output).to.equal('next');
			expect(value.status).to.equal('open');
			expect(value.errors.length).to.equal(2, 'Error-Count must have been increaed to 2 as the provided code was 403');
			expect(value.successCount).to.equal(0, 'Success-Count must have been reseted to 0');

		}).timeout(13000);

		it('should increase ErrorCount when using a simple Error-Code pattern 500', async () => {
			// This initializes a new Ciruit-Breaker with error count 0
			var { value, output } = await flowNode.configCheckCircuitBreaker({ 
				circuitBreakerId: 'SingleErrorCodePattern', 
				returnCodes: '500'
			});

			expect(value.status).to.equal('closed');
			expect(value.params.circuitBreakerId).to.equal('SingleErrorCodePattern');
			expect(value.params.returnCodes).to.equal('500');
			expect(output).to.equal('next');

			// Force an Error which SHOULD NOT increase the error count
			var { value, output } = await flowNode.updateCircuitBreaker({  circuitBreakerId: 'SingleErrorCodePattern', httpResponseCode: 499 });
			expect(output).to.equal('next');
			expect(value.status).to.equal('closed');
			expect(value.errors.length).to.equal(0, 'Errors.length should be 0 as the code 499 does not match to 500');

			// Force an Error which SHOULD increase the error count
			var { value, output } = await flowNode.updateCircuitBreaker({  circuitBreakerId: 'SingleErrorCodePattern', httpResponseCode: 500 });
			expect(output).to.equal('next');
			expect(value.status).to.equal('closed');
			expect(value.errors.length).to.equal(1, 'Errors.length should be 1 as the code 500 does match to 500');
		});

		it('should increase ErrorCount when using a combined Error-Code pattern [300-500], 999', async () => {
			// This initializes a new Ciruit-Breaker with error count 0
			var { value, output } = await flowNode.configCheckCircuitBreaker({ 
				circuitBreakerId: 'CombinedErrorCodePattern', 
				returnCodes: '[300-500], 999'
			});
			expect(value.status).to.equal('closed');
			expect(value.params.circuitBreakerId).to.equal('CombinedErrorCodePattern');
			expect(value.params.returnCodes).to.equal('[300-500], 999');
			expect(output).to.equal('next');

			// Force an Error which SHOULD NOT increase the error count as it is not within the given ErrorCodes
			var { value, output } = await flowNode.updateCircuitBreaker({  circuitBreakerId: 'CombinedErrorCodePattern', httpResponseCode: 600 });
			expect(output).to.equal('next');
			expect(value.status).to.equal('closed');
			expect(value.errors.length).to.equal(0, 'Errors.length should be 0 as the code 600 does not fall into the configured range [300-500], 999');

			// Force an Error which SHOULD increase the error count
			var { value, output } = await flowNode.updateCircuitBreaker({  circuitBreakerId: 'CombinedErrorCodePattern', httpResponseCode: 307 });
			expect(output).to.equal('next');
			expect(value.status).to.equal('closed');
			expect(value.errors.length).to.equal(1, 'Errors.length should be 1 as the code 307 does fall into the configured range [300-500], 999');
		});

		it('should use the error code map to avoid anaylzing the error-code over and over again', async () => {
			// This initializes a new Ciruit-Breaker with error count 0
			var { value, output } = await flowNode.configCheckCircuitBreaker({ 
				circuitBreakerId: 'ReturnCodeMap', 
				returnCodes: '[300-500], 999'
			});
			expect(value.params.returnCodes).to.equal('[300-500], 999');
			expect(output).to.equal('next');

			// Force an Error which SHOULD increase the error count
			var { value, output } = await flowNode.updateCircuitBreaker({  circuitBreakerId: 'ReturnCodeMap', httpResponseCode: 307 });
			expect(output).to.equal('next');
			expect(value.status).to.equal('closed');
			expect(value.errorCodeMap).to.deep.equal({307: true});
			expect(value.errors.length).to.equal(1, 'Errors.length should be 1 as the code 307 does fall into the configured range [300-500], 999');

			// Re-Run with the same Error-Code
			var { value, output } = await flowNode.updateCircuitBreaker({  circuitBreakerId: 'ReturnCodeMap', httpResponseCode: 307 });
			expect(output).to.equal('next');
			expect(value.status).to.equal('closed');
			expect(value.errors.length).to.equal(2, 'Errors.length should be 2 as the code 307 does fall into the configured range [300-500], 999');
		});
	});
});

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
