import { test } from 'qunit';
import { default as moduleFor }  from 'ember-qunit/module-for';
import sinon from 'sinon';

import DS from 'ember-data';
import Ember from 'ember';
// import { zip } from 'lodash';

import ProjectionModel from 'ember-m3/projection';
import MegamorphicModel from 'ember-m3/model';

import SchemaManager from 'ember-m3/schema-manager';
import { initialize as initializeStore } from 'ember-m3/initializers/m3-store';

const {
  // get,
  // set,
  run, RSVP: { Promise, } } = Ember;

moduleFor('m3:projection', 'unit/projection', {
  integration: true,

  beforeEach() {
    this.sinon = sinon.sandbox.create();
    initializeStore(this);

    this.Author = DS.Model.extend({
      name: DS.attr('string'),
      publishedBooks: DS.hasMany('com.example.bookstore.Book', { async: false }),
    });
    this.Author.toString = () => 'Author';
    this.register('model:author', this.Author);

    SchemaManager.registerSchema({
      modelIsProjection(modelName) {
        return /^com\.example\.bookstore\.projection\./i.test(modelName);
      },

      includesModel(modelName) {
        return /^com\.example\.bookstore\./i.test(modelName);
      },

      computeAttributeReference(key, value) {
        if (/^isbn:/.test(value)) {
          return {
            id: value,
            type: 'com.example.bookstore.Book',
          }
        } else if (/^urn:(\w+):(.*)/.test(value)) {
          let parts = /^urn:(\w+):(.*)/.exec(value);
          return {
            type: parts[1],
            id: parts[2],
          };
        }
      },

      isAttributeArrayReference(key) {
        return key === 'otherBooksInSeries';
      },

      computeNestedModel(key, value) {
        if (value && typeof value === 'object' && value.constructor !== Date) {
          return {
            type: value.type,
            id: value.id,
            attributes: value,
          }
        }
      },

      models: {
        'com.example.bookstore.Book': {
          aliases: {
            title: 'name',
            cost: 'price',
            pub: 'publisher',
            releaseDate: 'pubDate',
            pb: 'paperback',
            hb: 'hardback',
          },
          defaults: {
            publisher: 'Penguin Classics',
            hardback: true,
            paperback: true,
            publishedIn: 'US',
          },
          transforms: {
            publisher(value) {
              return `${value}, of course`;
            },
            pubDate(value) {
              return new Date(Date.parse(value));
            }
          }
        },
        'com.example.bookstore.projection.BookExcerpt': {
          projects: 'com.example.bookstore.Book',
          attributes: ['title', 'pub', 'releaseDate'],
        },
      }
    });
  },

  afterEach() {
    this.sinon.restore();
  },

  store: function() {
    return this.container.lookup('service:store');
  },
});

test('it appears as a model to ember data', function(assert) {
  assert.equal(ProjectionModel.isModel, true, 'M3Projection.isModel');
  assert.equal(ProjectionModel.klass, ProjectionModel, 'M3Projection.klass');

  let klassAttrsMap = ProjectionModel.attributes;
  assert.equal(typeof klassAttrsMap.has, 'function', 'M3Projection.attributes.has()');
});

test('it appears as a projection', function(assert) {
  assert.equal(ProjectionModel.isProjection, true, 'M3Projection.isProjection');
});

test('store.findRecord returns a ProjectionModel when schema.modelIsProjection() returns true', function(assert) {
  assert.expect(5);

  let expectedParams;

  this.register('adapter:-ember-m3', Ember.Object.extend({
    findRecord(store, modelClass, id, snapshot) {
      // TODO: this is annoying but name normalization means we get the wrong
      // model name in snapshots.  Should fix this upstream by dropping name
      // normalization.  See #11
      assert.equal(snapshot.modelName, expectedParams.modelName, 'findRecord snapshot has the correct modelName');
      assert.equal(modelClass, expectedParams.modelClass, 'findRecord received the correct modelClass');
      assert.equal(id, expectedParams.id, 'findRecord received the correct id');

      return Promise.resolve({
        data: {
          id: 'isbn:9780439708180',
          type: 'com.example.bookstore.projection.BookExcerpt'
        }
      });
    },
  }));

  run(() => {
    expectedParams = {
      modelName: 'com.example.bookstore.projection.book-excerpt',
      modelClass: ProjectionModel,
      id: 'isbn:9780439708180'
    };

    this.store().findRecord('com.example.bookstore.projection.BookExcerpt', 'isbn:9780439708180')
      .then(model => {
        assert.equal(model.get('id'), 'isbn:9780439708180', 'model.id');
        assert.equal(model.constructor, ProjectionModel, 'find on projection returns a ProjectionModel as its constructor');
      });
  });
});

test('store.findRecord fires a request for a projection even when the base-record is already loaded', function(assert) {
  assert.expect(10);

  let expectedParams;

  this.register('adapter:-ember-m3', Ember.Object.extend({
    findRecord(store, modelClass, id, snapshot) {
      // TODO: this is annoying but name normalization means we get the wrong
      // model name in snapshots.  Should fix this upstream by dropping name
      // normalization.  See #11
      assert.equal(snapshot.modelName, expectedParams.modelName, 'findRecord snapshot has the correct modelName');
      assert.equal(modelClass, expectedParams.modelClass, 'findRecord received the correct modelClass');
      assert.equal(id, expectedParams.id, 'findRecord received the correct id');

      return Promise.resolve({
        data: {
          id: 'isbn:9780439708180',
          type: modelClass.isProjection ? 'com.example.bookstore.projection.BookExcerpt'
            : 'com.example.bookstore.Book',
        }
      });
    },
  }));

 run(() => {
   expectedParams = {
     modelName: 'com.example.bookstore.book',
     modelClass: MegamorphicModel,
     id: 'isbn:9780439708180'
   };

   this.store().findRecord('com.example.bookstore.Book', 'isbn:9780439708180')
     .then(model => {
       assert.equal(model.get('id'), 'isbn:9780439708180', 'model.id');
       assert.equal(model.constructor, MegamorphicModel, 'find on non-projection returns a MegamorphicModel as its constructor');
     });
 });

  run(() => {
    expectedParams = {
      modelName: 'com.example.bookstore.projection.book-excerpt',
      modelClass: ProjectionModel,
      id: 'isbn:9780439708180'
    };

    this.store().findRecord('com.example.bookstore.projection.BookExcerpt', 'isbn:9780439708180')
      .then(model => {
        assert.equal(model.get('id'), 'isbn:9780439708180', 'model.id');
        assert.equal(model.constructor, ProjectionModel, 'find on projection returns a ProjectionModel as its constructor');
      });
  });
});

test('store.findRecord fires a request for the base-record even when a projection has already been fetched', function(assert) {
  assert.expect(10);

  let expectedParams;

  this.register('adapter:-ember-m3', Ember.Object.extend({
    findRecord(store, modelClass, id, snapshot) {
      // TODO: this is annoying but name normalization means we get the wrong
      // model name in snapshots.  Should fix this upstream by dropping name
      // normalization.  See #11
      assert.equal(snapshot.modelName, expectedParams.modelName, 'findRecord snapshot has the correct modelName');
      assert.equal(modelClass, expectedParams.modelClass, 'findRecord received the correct modelClass');
      assert.equal(id, expectedParams.id, 'findRecord received the correct id');

      return Promise.resolve({
        data: {
          id: 'isbn:9780439708180',
          type: modelClass.isProjection ? 'com.example.bookstore.projection.BookExcerpt'
            : 'com.example.bookstore.Book',
        }
      });
    },
  }));

  run(() => {
    expectedParams = {
      modelName: 'com.example.bookstore.projection.book-excerpt',
      modelClass: ProjectionModel,
      id: 'isbn:9780439708180'
    };

    this.store().findRecord('com.example.bookstore.projection.BookExcerpt', 'isbn:9780439708180')
      .then(model => {
        assert.equal(model.get('id'), 'isbn:9780439708180', 'model.id');
        assert.equal(model.constructor, ProjectionModel, 'find on projection returns a ProjectionModel as its constructor');
      });
  });

  run(() => {
    expectedParams = {
      modelName: 'com.example.bookstore.book',
      modelClass: MegamorphicModel,
      id: 'isbn:9780439708180'
    };

    this.store().findRecord('com.example.bookstore.Book', 'isbn:9780439708180')
      .then(model => {
        assert.equal(model.get('id'), 'isbn:9780439708180', 'model.id');
        assert.equal(model.constructor, MegamorphicModel, 'find on non-projection returns a MegamorphicModel as its constructor');
      });
  });
});
