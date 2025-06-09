const { getHubspotClient } = require('./hubspotClient');
const { generateLastModifiedDateFilter, saveDomain, withRetry } = require('./utils');
const { refreshAccessToken } = require('./hubspotClient');
const { filterNullValuesFromObject } = require('../../utils');

/**
 * Get recently modified meetings as 100 meetings per page
 */
const processMeetings = async (domain, hubId, q) => {
  const account = domain.integrations.hubspot.accounts.find(account => account.hubId === hubId);
  const lastPulledDate = new Date(account.lastPulledDates.meetings);
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
        'hs_meeting_title',
        'hs_meeting_start_time',
        'hs_meeting_end_time',
        'hs_meeting_outcome',
        'hs_meeting_body'
      ],
      limit,
      after: offsetObject.after
    };

    const searchResult = await withRetry(
      () => getHubspotClient().crm.objects.meetings.searchApi.doSearch(searchObject),
      () => refreshAccessToken(domain, hubId)
    );

    if (!searchResult) throw new Error('Failed to fetch meetings for the 4th time. Aborting.');

    const data = searchResult?.results || [];
    offsetObject.after = parseInt(searchResult?.paging?.next?.after);

    console.log('fetch meeting batch');

    const meetingIds = data.map(({ id }) => id);

    // meeting to contact association
    const meetingAssociations = (await (await getHubspotClient().apiRequest({
      method: 'post',
      path: '/crm/v3/associations/MEETINGS/CONTACTS/batch/read',
      body: { inputs: meetingIds.map(meetingId => ({ id: meetingId })) }
    })).json())?.results || [];

    const contactAssociations = Object.fromEntries(meetingAssociations.map(meetingAssociations => {
      if (meetingAssociations.from && meetingAssociations.to && meetingAssociations.to.length > 0) {
        return [meetingAssociations.from.id, meetingAssociations.to[0].id];
      } else return false;
    }).filter(meetingAssociations => meetingAssociations));

    // Get contact details (emails) for associated contacts
    const contactIds = Object.values(contactAssociations);
    let contactEmails = {};
    
    if (contactIds.length > 0) {
      const contactsResult = (await (await getHubspotClient().apiRequest({
        method: 'post',
        path: '/crm/v3/objects/contacts/batch/read',
        body: { 
          inputs: contactIds.map(contactId => ({ id: contactId })),
          properties: ['email']
        }
      })).json())?.results || [];

      contactEmails = Object.fromEntries(contactsResult.map(contact => [
        contact.id, 
        contact.properties?.email
      ]).filter(([_, email]) => email));
    }

    data.forEach(({ properties, id, createdAt, updatedAt }) => {
      if (!properties) return;

      const contactId = contactAssociations[id];
      const contactEmail = contactId ? contactEmails[contactId] : null;

      // Skip meetings without associated contact email
      if (!contactEmail) return;

      const isCreated = !lastPulledDate || (new Date(createdAt) > lastPulledDate);

      const meetingProperties = {
        meeting_id: id,
        meeting_title: properties.hs_meeting_title,
        meeting_start_time: properties.hs_meeting_start_time,
        meeting_end_time: properties.hs_meeting_end_time,
        meeting_outcome: properties.hs_meeting_outcome
      };

      const actionTemplate = {
        includeInAnalytics: 0,
        identity: contactEmail,
        userProperties: filterNullValuesFromObject(meetingProperties)
      };

      q.push({
        actionName: isCreated ? 'Meeting Created' : 'Meeting Updated',
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

  account.lastPulledDates.meetings = now;
  await saveDomain(domain);

  return true;
};

module.exports = {
  processMeetings
};