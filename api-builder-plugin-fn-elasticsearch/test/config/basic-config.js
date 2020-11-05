const fs = require('fs');

module.exports = {
	pluginConfig: {
		'@axway-api-builder-ext/api-builder-plugin-fn-elasticsearch': {
			'elastic': {
				node: 'http://api-env:9200', 
				auth: {
					/* Use an API-Key
					apiKey: process.env.ELASTIC_API_KEY
					  or username / password based
					username: process.env.ELASTIC_USERNAME, 
					username: process.env.ELASTIC_PASSWORD
					*/
				}, 
				// The name to identify the client instance in the events.
				name: 'api-builder',
				// You can use all configuration options documented here: 
				// https://www.elastic.co/guide/en/elasticsearch/client/javascript-api/7.x/client-configuration.html
				ssl: {
					ca: fs.readFileSync('C:/temp/ca.crt'),
					rejectUnauthorized: false
				}
			}
		}
	}
};
