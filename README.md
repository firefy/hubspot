# API Sample Test

## Getting Started

This project requires a newer version of Node. Don't forget to install the NPM packages afterwards.

You should change the name of the ```.env.example``` file to ```.env```.

Run ```node app.js``` to get things started. Hopefully the project should start without any errors.

## Explanations

The actual task will be explained separately.

This is a very simple project that pulls data from HubSpot's CRM API. It pulls and processes company and contact data from HubSpot but does not insert it into the database.

In HubSpot, contacts can be part of companies. HubSpot calls this relationship an association. That is, a contact has an association with a company. We make a separate call when processing contacts to fetch this association data.

The Domain model is a record signifying a HockeyStack customer. You shouldn't worry about the actual implementation of it. The only important property is the ```hubspot```object in ```integrations```. This is how we know which HubSpot instance to connect to.

The implementation of the server and the ```server.js``` is not important for this project.

Every data source in this project was created for test purposes. If any request takes more than 5 seconds to execute, there is something wrong with the implementation.

## Technical Debrief - HubSpot Meetings Integration

### Implementation Summary
I realised meetings data extraction from HubSpot API following the existing pattern. The solution fetches meetings, retrieves contact associations, and creates `Meeting Created`/`Meeting Updated` actions with contact email information.

### Debrief TODO
Through the code of the test, I noticed some duplication across `processContacts`, `processCompanies`, and `processMeetings` methods. Ideally, here we should extract common pagination logic, API retry mechanisms, and association handling into reusable utility functions. The current codbase lacks TypeScript it would be nice to have it here. One more thing to add centralized error messages for better debugging in production environments. I made the first step with the architecture by dividing functions to smaller pieces of code. But it could be improved by adding additional an abstraction layer. And may be even  adding separate workers for each data type (contacts, companies, meetings). The current monolithic worker approach doesn't scale well. The most critical issue with perfomance is the multiple api calls per meeting - first to get meetings, then associations, then contanct details. It would be nice to implement intelligent caching for contact data since the same contacts appear in multiple meetings and also the current 100-item pagination might be too small for large datasets, causing unnecessary API overhead.