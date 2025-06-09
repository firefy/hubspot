const Domain = require('./Domain');
const { hubspot, queueService } = require('./services');

const pullDataFromHubspot = async () => {
  console.log('start pulling data from HubSpot');

  const domain = await Domain.findOne({});

  for (const account of domain.integrations.hubspot.accounts) {
    console.log('start processing account');

    try {
      await hubspot.refreshAccessToken(domain, account.hubId);
    } catch (err) {
      console.log(err, { apiKey: domain.apiKey, metadata: { operation: 'refreshAccessToken' } });
    }

    const actions = [];
    const queue = queueService.createQueue(domain, actions);

    try {
      await hubspot.processContacts(domain, account.hubId, queue);
      console.log('process contacts');
    } catch (err) {
      console.log(err, { apiKey: domain.apiKey, metadata: { operation: 'processContacts', hubId: account.hubId } });
    }

    try {
      await hubspot.processCompanies(domain, account.hubId, queue);
      console.log('process companies');
    } catch (err) {
      console.log(err, { apiKey: domain.apiKey, metadata: { operation: 'processCompanies', hubId: account.hubId } });
    }

    try {
      await hubspot.processMeetings(domain, account.hubId, queue);
      console.log('process meetings');
    } catch (err) {
      console.log(err, { apiKey: domain.apiKey, metadata: { operation: 'processMeetings', hubId: account.hubId } });
    }

    try {
      await queueService.drainQueue(actions, queue);
      console.log('drain queue');
    } catch (err) {
      console.log(err, { apiKey: domain.apiKey, metadata: { operation: 'drainQueue', hubId: account.hubId } });
    }

    console.log('finish processing account');
  }

  process.exit();
};

module.exports = pullDataFromHubspot;
