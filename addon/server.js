/* eslint no-console: 0 */

import { singularize, pluralize, camelize } from './utils/inflector';
import { toCollectionName, toInternalCollectionName } from 'ember-cli-mirage/utils/normalize-name';
import { getModels } from './ember-data';
import { hasEmberData } from './utils/ember-data';
import isAssociation from 'ember-cli-mirage/utils/is-association';
import Db from './db';
import Schema from './orm/schema';
import assert from './assert';
import SerializerRegistry from './serializer-registry';
import BelongsTo from './orm/associations/belongs-to';

import _pick from 'lodash/pick';
import _assign from 'lodash/assign';
import _find from 'lodash/find';
import _isPlainObject from 'lodash/isPlainObject';
import _isInteger from 'lodash/isInteger';

/**
  The Mirage server.

  Note that `this` within your config function in `mirage/config.js` refers to the server instance, which is the same instance that `server` refers to in your tests.

  @class Server
  @public
*/
export default class Server {

  constructor(options = {}) {
    this.config(options);

    /**
      Returns the Mirage Db instance.

      @property db
      @return Db
    */
    this.db = this.db || undefined;

    /**
      Returns the Mirage Schema (ORM) instance.

      @property schema
      @return Schema
    */
    this.schema = this.schema || undefined;
  }

  config(config = {}) {
    let didOverrideConfig = (config.environment && (this.environment && (this.environment !== config.environment)));
    assert(!didOverrideConfig,
      'You cannot modify Mirage\'s environment once the server is created');
    this.environment = config.environment || this.environment || 'development';

    this._config = config;

    /**
      Set the base namespace used for all routes defined with `get`, `post`, `put` or `del`.

      For example,

      ```js
      // mirage/config.js
      export default function() {
        this.namespace = '/api';

        // this route will handle the URL '/api/contacts'
        this.get('/contacts', 'contacts');
      };
      ```

      Note that only routes defined after `this.namespace` are affected. This is useful if you have a few one-off routes that you don't want under your namespace:

      ```js
      // mirage/config.js
      export default function() {

        // this route handles /auth
        this.get('/auth', function() { ...});

        this.namespace = '/api';
        // this route will handle the URL '/api/contacts'
        this.get('/contacts', 'contacts');
      };
      ```

      If your Ember app is loaded from the filesystem vs. a server (e.g. via Cordova or Electron vs. `ember s` or `https://yourhost.com/`), you will need to explicitly define a namespace. Likely values are `/` (if requests are made with relative paths) or `https://yourhost.com/api/...` (if requests are made to a defined server).

      For a sample implementation leveraging a configured API host & namespace, check out [this issue comment](https://github.com/samselikoff/ember-cli-mirage/issues/497#issuecomment-183458721).

      @property namespace
      @type String
      @public
    */
    this.namespace = this.namespace || config.namespace || '';

    /**
      Sets a string to prefix all route handler URLs with.

      Useful if your Ember app makes API requests to a different port.

      ```js
      // mirage/config.js
      export default function() {
        this.urlPrefix = 'http://localhost:8080'
      };
      ```
    */
    this.urlPrefix = this.urlPrefix || config.urlPrefix || '';

    /**
      Set the number of milliseconds for the the Server's response time.

      By default there's a 400ms delay during development, and 0 delay in testing (so your tests run fast).

      ```js
      // mirage/config.js
      export default function() {
        this.timing = 400; // default
      };
      ```

      To set the timing for individual routes, see the `timing` option for route handlers.

      @property timing
      @type Number
      @public
    */
    this.timing = this.timing || config.timing || 400;

    this.logging = this.logging || undefined;

    /**
      Export a named `testConfig` function to define routes that only apply in your test environment:

      ```js
      // mirage/config.js
      export default function() {
        // normal config, shared across development + testing
      }

      export function testConfig() {
        // test-only config, does not apply to development
      }
      ```

      This could be useful if you'd like to use Mirage in testing, but generally proxy to an actual API during development. As you develop, your frontend may be ahead of your API, in which case you'd work with the routes in the default config, and write your tests. Then, once your API implements the new endpoints, you can move the routes to your testConfig, so your tests still run, but Mirage doesn't interfere during development.
    */
    this.testConfig = this.testConfig || undefined;

    this.trackRequests = config.trackRequests;

    // Merge models from autogenerated Ember Data models with user defined models
    if (hasEmberData && config.discoverEmberDataModels) {
      let models = {};
      _assign(models, getModels(), config.models || {});
      config.models = models;
    }

    if (this.db) {
      this.db.registerIdentityManagers(config.identityManagers);
    } else {
      this.db = new Db(undefined, config.identityManagers);
    }

    if (this.schema) {
      this.schema.registerModels(config.models);
      this.serializerOrRegistry.registerSerializers(config.serializers || {});
    } else {
      this.schema = new Schema(this.db, config.models);
      this.serializerOrRegistry = new SerializerRegistry(this.schema, config.serializers);
    }

    let hasFactories = this._hasModulesOfType(config, 'factories');
    let hasDefaultScenario = config.scenarios && config.scenarios.hasOwnProperty('default');

    if (config.baseConfig) {
      this.loadConfig(config.baseConfig);
    }

    if (this.isTest()) {
      if (config.testConfig) {
        this.loadConfig(config.testConfig);
      }

      window.server = this; // TODO: Better way to inject server into test env
    }

    if (this.isTest() && hasFactories) {
      this.loadFactories(config.factories);
    } else if (!this.isTest() && hasDefaultScenario) {
      this.loadFactories(config.factories);
      config.scenarios.default(this);
    } else {
      this.loadFixtures();
    }
  }

  /**
   * Determines if the current environment is the testing environment.
   *
   * @method isTest
   * @return {Boolean} True if the environment is 'test', false otherwise.
   * @public
   * @hide
   */
  isTest() {
    return this.environment === 'test';
  }

  /**
    Determines if the server should log.

    @method shouldLog
    @return The value of this.logging if defined, or false if in the testing environment,
    true otherwise.
    @public
    @hide
  */
  shouldLog() {

    return typeof this.logging !== 'undefined' ? this.logging : !this.isTest();
  }

  /**
   * Determines if the server should track requests.
   *
   * @method shouldTrackRequests
   * @return The value of this.trackRequests if defined, false otherwise.
   * @public
   * @hide
   */
  shouldTrackRequests() {
    return Boolean(this.trackRequests);
  }

  /**
   * Load the configuration given, setting timing to 0 if in the test
   * environment.
   *
   * @method loadConfig
   * @param {Object} config The configuration to load.
   * @public
   * @hide
   */
  loadConfig(config) {
    config.call(this);
    this.timing = this.isTest() ? 0 : (this.timing || 0);
  }

  /**
    By default, all the data files under `/fixtures` will be loaded during testing if you don't have factories defined, and during development if you don't have `/scenarios/default.js` defined. You can use `loadFixtures()` to also load fixture files in either of these environments, in addition to using factories to seed your database.

    `server.loadFixtures()` loads all the files, and `server.loadFixtures(file1, file2...)` loads selective fixture files.

    For example, in a test you may want to start out with all your fixture data loaded:

    ```js
    test('I can view the photos', function() {
      server.loadFixtures();
      server.createList('photo', 10);

      visit('/');

      andThen(() => {
        equal( find('img').length, 10 );
      });
    });
    ```

    or in development, you may want to load a few reference fixture files, and use factories to define the rest of your data:

    ```js
    // scenarios/default.js
    export default function(server) {
      server.loadFixtures('countries', 'states');

      let author = server.create('author');
      server.createList('post', 10, {author_id: author.id});
    }
    ```

    @method loadFixtures
    @param {String} [...args] The name of the fixture to load.
    @public
  */
  loadFixtures(...args) {
    let { fixtures } = this._config;
    if (args.length) {
      let camelizedArgs = args.map(camelize);
      fixtures = _pick(fixtures, ...camelizedArgs);
    }

    this.db.loadData(fixtures);
  }

  /*
    Factory methods
  */

  /**
   * Load factories into Mirage's database.
   *
   * @method loadFactories
   * @param {Object} factoryMap
   * @public
   * @hide
   */
  loadFactories(factoryMap = {}) {
    // Store a reference to the factories
    let currentFactoryMap = this._factoryMap || {};
    this._factoryMap = _assign(currentFactoryMap, factoryMap);

    // Create a collection for each factory
    Object.keys(factoryMap).forEach((type) => {
      let collectionName = toCollectionName(type);
      this.db.createCollection(collectionName);
    });
  }

  /**
   * Get the factory for a given type.
   *
   * @method factoryFor
   * @param {String} type
   * @private
   * @hide
   */
  factoryFor(type) {
    let camelizedType = camelize(type);

    if (this._factoryMap && this._factoryMap[camelizedType]) {
      return this._factoryMap[camelizedType];
    }
  }

  build(type, ...traitsAndOverrides) {
    let traits = traitsAndOverrides.filter((arg) => arg && typeof arg === 'string');
    let overrides = _find(traitsAndOverrides, (arg) => _isPlainObject(arg));
    let camelizedType = camelize(type);

    // Store sequence for factory type as instance variable
    this.factorySequences = this.factorySequences || {};
    this.factorySequences[camelizedType] = this.factorySequences[camelizedType] + 1 || 0;

    let OriginalFactory = this.factoryFor(type);
    if (OriginalFactory) {
      OriginalFactory = OriginalFactory.extend({});
      let attrs = OriginalFactory.attrs || {};
      this._validateTraits(traits, OriginalFactory, type);
      let mergedExtensions = this._mergeExtensions(attrs, traits, overrides);
      this._mapAssociationsFromAttributes(type, attrs, overrides);
      this._mapAssociationsFromAttributes(type, mergedExtensions);

      let Factory = OriginalFactory.extend(mergedExtensions);
      let factory = new Factory();

      let sequence = this.factorySequences[camelizedType];
      return factory.build(sequence);
    } else {
      return overrides;
    }
  }

  buildList(type, amount, ...traitsAndOverrides) {
    assert(_isInteger(amount), `second argument has to be an integer, you passed: ${typeof amount}`);

    let list = [];

    for (let i = 0; i < amount; i++) {
      list.push(this.build(type, ...traitsAndOverrides));
    }

    return list;
  }

  /**
    Generates a single model of type *type*, inserts it into the database (giving it an id), and returns the data that was
    added.

    ```js
    test("I can view a contact's details", function() {
      var contact = server.create('contact');

      visit('/contacts/' + contact.id);

      andThen(() => {
        equal( find('h1').text(), 'The contact is Link');
      });
    });
    ```

    You can override the attributes from the factory definition with a
    hash passed in as the second parameter. For example, if we had this factory

    ```js
    export default Factory.extend({
      name: 'Link'
    });
    ```

    we could override the name like this:

    ```js
    test("I can view the contacts", function() {
      server.create('contact', {name: 'Zelda'});

      visit('/');

      andThen(() => {
        equal( find('p').text(), 'Zelda' );
      });
    });
    ```

    @method create
    @param type the singularized type of the model
    @param traitsAndOverrides
    @public
  */
  create(type, ...options) {
    assert(this._modelOrFactoryExistsForType(type), `You called server.create('${type}') but no model or factory was found. Make sure you're passing in the singularized version of the model or factory name.`);

    // When there is a Model defined, we should return an instance
    // of it instead of returning the bare attributes.
    let traits = options.filter((arg) => arg && typeof arg === 'string');
    let overrides = _find(options, (arg) => _isPlainObject(arg));
    let collectionFromCreateList = _find(options, (arg) => arg && Array.isArray(arg));

    let attrs = this.build(type, ...traits, overrides);
    let modelOrRecord;

    if (this.schema && this.schema[toCollectionName(type)]) {
      let modelClass = this.schema[toCollectionName(type)];

      modelOrRecord = modelClass.create(attrs);

    } else {
      let collection, collectionName;

      if (collectionFromCreateList) {
        collection = collectionFromCreateList;
      } else {
        collectionName = this.schema ? toInternalCollectionName(type) : `_${pluralize(type)}`;
        collection = this.db[collectionName];
      }

      assert(collection, `You called server.create('${type}') but no model or factory was found.`);
      modelOrRecord = collection.insert(attrs);
    }

    let OriginalFactory = this.factoryFor(type);
    if (OriginalFactory) {
      OriginalFactory.extractAfterCreateCallbacks({ traits }).forEach((afterCreate) => {
        afterCreate(modelOrRecord, this);
      });
    }

    return modelOrRecord;
  }

  /**
    Creates *amount* models of type *type*, optionally overriding the attributes from the factory with *attrs*.

    Returns the array of records that were added to the database.

    Here's an example from a test:

    ```js
    test("I can view the contacts", function() {
      server.createList('contact', 5);
      var youngContacts = server.createList('contact', 5, {age: 15});

      visit('/');

      andThen(function() {
        equal(currentRouteName(), 'index');
        equal( find('p').length, 10 );
      });
    });
    ```

    And one from setting up your development database:

    ```js
    // mirage/scenarios/default.js
    export default function(server) {
      var contact = server.create('contact');
      server.createList('address', 5, {contactId: contact.id});
    }
    ```

    @method createList
    @param type
    @param amount
    @param traitsAndOverrides
    @public
  */
  createList(type, amount, ...traitsAndOverrides) {
    assert(this._modelOrFactoryExistsForType(type), `You called server.createList('${type}') but no model or factory was found. Make sure you're passing in the singularized version of the model or factory name.`);
    assert(_isInteger(amount), `second argument has to be an integer, you passed: ${typeof amount}`);

    let list = [];
    let collectionName = this.schema ? toInternalCollectionName(type) : `_${pluralize(type)}`;
    let collection = this.db[collectionName];

    for (let i = 0; i < amount; i++) {
      list.push(this.create(type, ...traitsAndOverrides, collection));
    }

    return list;
  }

  shutdown() {
    if (this.environment === 'test') {
      window.server = undefined;
    }
  }

  resource(resourceName, { only, except, path } = {}) {
    resourceName = pluralize(resourceName);
    path = path || `/${resourceName}`;
    only = only || [];
    except = except || [];

    if (only.length > 0 && except.length > 0) {
      throw 'cannot use both :only and :except options';
    }

    let actionsMethodsAndsPathsMappings = {
      index: { methods: ['get'], path: `${path}` },
      show: { methods: ['get'], path: `${path}/:id` },
      create: { methods: ['post'], path: `${path}` },
      update: { methods: ['put', 'patch'], path: `${path}/:id` },
      delete: { methods: ['del'], path: `${path}/:id` }
    };

    let allActions = Object.keys(actionsMethodsAndsPathsMappings);
    let actions = only.length > 0 && only
                  || except.length > 0 && allActions.filter((action) => (except.indexOf(action) === -1))
                  || allActions;

    actions.forEach((action) => {
      let methodsWithPath = actionsMethodsAndsPathsMappings[action];

      methodsWithPath.methods.forEach((method) => {
        return path === resourceName
          ? this[method](methodsWithPath.path)
          : this[method](methodsWithPath.path, resourceName);
      });
    });
  }

  /**
   *
   * @private
   * @hide
   */
  _hasModulesOfType(modules, type) {
    let modulesOfType = modules[type];
    return modulesOfType ? Object.keys(modulesOfType).length > 0 : false;
  }

  /**
   *
   * @private
   * @hide
   */
  _typeIsPluralForModel(typeOrCollectionName) {
    let modelOrFactoryExists = this._modelOrFactoryExistsForTypeOrCollectionName(typeOrCollectionName);
    let isPlural = typeOrCollectionName === pluralize(typeOrCollectionName);
    let isUncountable = singularize(typeOrCollectionName) === pluralize(typeOrCollectionName);

    return isPlural && !isUncountable && modelOrFactoryExists;
  }

  /**
   *
   * @private
   * @hide
   */
  _modelOrFactoryExistsForType(type) {
    let modelExists = (this.schema && this.schema.modelFor(camelize(type)));
    let dbCollectionExists = this.db[toInternalCollectionName(type)];

    return (modelExists || dbCollectionExists) && !this._typeIsPluralForModel(type);
  }

  /**
   *
   * @private
   * @hide
   */
  _modelOrFactoryExistsForTypeOrCollectionName(typeOrCollectionName) {
    let modelExists = (this.schema && this.schema.modelFor(camelize(typeOrCollectionName)));
    let dbCollectionExists = this.db[toInternalCollectionName(typeOrCollectionName)];

    return modelExists || dbCollectionExists;
  }

  /**
   *
   * @private
   * @hide
   */
  _validateTraits(traits, factory, type) {
    traits.forEach((traitName) => {
      if (!factory.isTrait(traitName)) {
        throw new Error(`'${traitName}' trait is not registered in '${type}' factory`);
      }
    });
  }

  /**
   *
   * @private
   * @hide
   */
  _mergeExtensions(attrs, traits, overrides) {
    let allExtensions = traits.map((traitName) => {
      return attrs[traitName].extension;
    });
    allExtensions.push(overrides || {});
    return allExtensions.reduce((accum, extension) => {
      return _assign(accum, extension);
    }, {});
  }

  /**
   *
   * @private
   * @hide
   */
  _mapAssociationsFromAttributes(modelName, attributes, overrides = {}) {
    Object.keys(attributes || {}).filter((attr) => {
      return isAssociation(attributes[attr]);
    }).forEach((attr) => {
      let modelClass = this.schema.modelClassFor(modelName);
      let association = modelClass.associationFor(attr);

      assert(association && association instanceof BelongsTo,
        `You're using the \`association\` factory helper on the '${attr}' attribute of your ${modelName} factory, but that attribute is not a \`belongsTo\` association. Read the Factories docs for more information: http://www.ember-cli-mirage.com/docs/v0.3.x/factories/#factories-and-relationships`
      );

      let isSelfReferentialBelongsTo = association && association instanceof BelongsTo && association.modelName === modelName;

      assert(!isSelfReferentialBelongsTo, `You're using the association() helper on your ${modelName} factory for ${attr}, which is a belongsTo self-referential relationship. You can't do this as it will lead to infinite recursion. You can move the helper inside of a trait and use it selectively.`);

      let factoryAssociation = attributes[attr];
      let foreignKey = `${camelize(attr)}Id`;
      if (!overrides[attr]) {
        attributes[foreignKey] = this.create(association.modelName, ...factoryAssociation.traitsAndOverrides).id;
      }
      delete attributes[attr];
    });
  }
}
