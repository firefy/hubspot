const generateLastModifiedDateFilter = (date, nowDate, propertyName = 'hs_lastmodifieddate') => {
  const lastModifiedDateFilter = date ?
    {
      filters: [
        { propertyName, operator: 'GTE', value: `${date.valueOf()}` },
        { propertyName, operator: 'LTE', value: `${nowDate.valueOf()}` }
      ]
    } :
    {};

  return lastModifiedDateFilter;
};

const saveDomain = async domain => {
  // disable this for testing purposes
  return;

  domain.markModified('integrations.hubspot.accounts');
  await domain.save();
};

const withRetry = async (operation, refreshTokenFn, maxRetries = 4) => {
  let tryCount = 0;
  
  while (tryCount <= maxRetries) {
    try {
      return await operation();
    } catch (err) {
      tryCount++;
      
      if (new Date() > require('./hubspotClient').getExpirationDate()) {
        await refreshTokenFn();
      }
      
      if (tryCount > maxRetries) {
        throw err;
      }
      
      await new Promise(resolve => setTimeout(resolve, 5000 * Math.pow(2, tryCount)));
    }
  }
};

module.exports = {
  generateLastModifiedDateFilter,
  saveDomain,
  withRetry
};