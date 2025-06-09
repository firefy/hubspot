const { getHubspotClient } = require('./hubspotClient');
const { generateLastModifiedDateFilter, saveDomain, withRetry } = require('./utils');
const { refreshAccessToken } = require('./hubspotClient');
const { filterNullValuesFromObject } = require('../../utils');

/**
 * Get recently modified companies as 100 companies per page
 */
const processCompanies = async (domain, hubId, queue) => {
  const account = domain.integrations.hubspot.accounts.find(account => account.hubId === hubId);
  const lastPulledDate = new Date(account.lastPulledDates.companies);
  const now = new Date();

  let hasMore = true;
  const offsetObject = {};
  const limit = 100;

  while (hasMore) {
    const lastModifiedDate = offsetObject.lastModifiedDate || lastPulledDate;
    const lastModifiedDateFilter = generateLastModifiedDateFilter(lastModifiedDate, now);
    const searchObject = {
      filterGroups: [lastModifiedDateFilter],
      sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'ASCENDING' }],
      properties: [
        'name',
        'domain',
        'country',
        'industry',
        'description',
        'annualrevenue',
        'numberofemployees',
        'hs_lead_status'
      ],
      limit,
      after: offsetObject.after
    };

    const searchResult = await withRetry(
      () => getHubspotClient().crm.companies.searchApi.doSearch(searchObject),
      () => refreshAccessToken(domain, hubId)
    );

    if (!searchResult) throw new Error('Failed to fetch companies for the 4th time. Aborting.');

    const data = searchResult?.results || [];
    offsetObject.after = parseInt(searchResult?.paging?.next?.after);

    console.log('fetch company batch');

    data.forEach(({ properties, id, createdAt, updatedAt }) => {
      if (!properties) return;

      const actionTemplate = {
        includeInAnalytics: 0,
        companyProperties: {
          company_id: id,
          company_domain: properties.domain,
          company_industry: properties.industry
        }
      };

      const isCreated = !lastPulledDate || (new Date(createdAt) > lastPulledDate);

      queue.push({
        actionName: isCreated ? 'Company Created' : 'Company Updated',
        actionDate: new Date(isCreated ? createdAt : updatedAt) - 2000,
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

  account.lastPulledDates.companies = now;
  await saveDomain(domain);

  return true;
};

module.exports = {
  processCompanies
};