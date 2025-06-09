const { getHubspotClient } = require('./hubspotClient');
const { generateLastModifiedDateFilter, saveDomain, withRetry } = require('./utils');
const { refreshAccessToken } = require('./hubspotClient');
const { filterNullValuesFromObject } = require('../../utils');

/**
 * Get recently modified contacts as 100 contacts per page
 */
const processContacts = async (domain, hubId, queue) => {
  const account = domain.integrations.hubspot.accounts.find(account => account.hubId === hubId);
  const lastPulledDate = new Date(account.lastPulledDates.contacts);
  const now = new Date();

  let hasMore = true;
  const offsetObject = {};
  const limit = 100;

  while (hasMore) {
    const lastModifiedDate = offsetObject.lastModifiedDate || lastPulledDate;
    const lastModifiedDateFilter = generateLastModifiedDateFilter(lastModifiedDate, now, 'lastmodifieddate');
    const searchObject = {
      filterGroups: [lastModifiedDateFilter],
      sorts: [{ propertyName: 'lastmodifieddate', direction: 'ASCENDING' }],
      properties: [
        'firstname',
        'lastname',
        'jobtitle',
        'email',
        'hubspotscore',
        'hs_lead_status',
        'hs_analytics_source',
        'hs_latest_source'
      ],
      limit,
      after: offsetObject.after
    };

    const searchResult = await withRetry(
      () => getHubspotClient().crm.contacts.searchApi.doSearch(searchObject),
      () => refreshAccessToken(domain, hubId)
    );

    if (!searchResult) throw new Error('Failed to fetch contacts for the 4th time. Aborting.');

    const data = searchResult.results || [];

    console.log('fetch contact batch');

    offsetObject.after = parseInt(searchResult.paging?.next?.after);
    const contactIds = data.map(({ id }) => id);

    // contact to company association
    const contactsToAssociate = contactIds;
    const companyAssociationsResults = (await (await getHubspotClient().apiRequest({
      method: 'post',
      path: '/crm/v3/associations/CONTACTS/COMPANIES/batch/read',
      body: { inputs: contactsToAssociate.map(contactId => ({ id: contactId })) }
    })).json())?.results || [];

    const companyAssociations = Object.fromEntries(companyAssociationsResults.map(companyAssociationsResult => {
      if (companyAssociationsResult.from) {
        contactsToAssociate.splice(contactsToAssociate.indexOf(companyAssociationsResult.from.id), 1);
        return [companyAssociationsResult.from.id, companyAssociationsResult.to[0].id];
      } else return false;
    }).filter(contactsToAssociates => contactsToAssociates));

    data.forEach(({ properties, id, createdAt, updatedAt }) => {
      if (!properties || !properties.email) return;

      const companyId = companyAssociations[id];

      const isCreated = new Date(createdAt) > lastPulledDate;

      const userProperties = {
        company_id: companyId,
        contact_name: ((properties.firstname || '') + ' ' + (properties.lastname || '')).trim(),
        contact_title: properties.jobtitle,
        contact_source: properties.hs_analytics_source,
        contact_status: properties.hs_lead_status,
        contact_score: parseInt(properties.hubspotscore) || 0
      };

      const actionTemplate = {
        includeInAnalytics: 0,
        identity: properties.email,
        userProperties: filterNullValuesFromObject(userProperties)
      };

      queue.push({
        actionName: isCreated ? 'Contact Created' : 'Contact Updated',
        actionDate: new Date(isCreated ? createdAt : updatedAt),
        ...actionTemplate
      });
    });

    if (!offsetObject?.after) {
      hasMore = false;
      break;
    } else if (offsetObject?.after >= 9900) {
      offsetObject.after = 0;
      offsetObject.lastModifiedDate = new Date(data[data.length - 1].updatedAt).valueOf();
    }
  }

  account.lastPulledDates.contacts = now;
  await saveDomain(domain);

  return true;
};

module.exports = {
  processContacts
};