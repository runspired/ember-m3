import { test } from 'qunit';
import { default as moduleFor }  from 'ember-qunit/module-for';
import sinon from 'sinon';

import DS from 'ember-data';
import Ember from 'ember';
import { zip } from 'lodash';

import MegamorphicModel from 'ember-m3/model';
import SchemaManager from 'ember-m3/schema-manager';
import { initialize as initializeStore } from 'ember-m3/initializers/m3-store';

const { get, set, run, RSVP: { Promise, } } = Ember;

moduleFor('m3:model', 'unit/model', {
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
      includesModel(modelName) {
        return /^com.example.bookstore\./i.test(modelName);
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
        }
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
  assert.equal(MegamorphicModel.isModel, true, 'M3.isModel');
  assert.equal(MegamorphicModel.klass, MegamorphicModel, 'M3.klass');

  let klassAttrsMap = MegamorphicModel.attributes;
  assert.equal(typeof klassAttrsMap.has, 'function', 'M3.attributes.has()');
});

test('.unknownProperty returns undefined for attributes not included in the schema', function(assert) {
  let model = run(() => {
    return this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
        attributes: {
          title: `Harry Potter and the Sorcerer's Stone`,
        },
      }
    });
  });

  assert.equal(get(model, 'title'), `Harry Potter and the Sorcerer's Stone`);
  assert.equal(get(model, 'pubDate'), undefined);
});

test('.unknownProperty returns schema-transformed values', function(assert) {
  let model = run(() => {
    return this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
        attributes: {
          pubDate: '01 September 1998',
        },
      }
    });
  });

  assert.equal(get(model, 'pubDate').getTime(), new Date(Date.parse('01 September 1998')).getTime());
});

test('.unknownProperty resolves id-matched values to external m3-models', function(assert) {
  let model = run(() => {
    return this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and the Sorcerer's Stone`,
          followedBy: 'isbn:9780439064873',
        },
      },
      included: [{
        id: 'isbn:9780439064873',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and the Chamber of Secrets`,
        },
      }]
    });
  });

  assert.equal(get(model, 'followedBy.name'), 'Harry Potter and the Chamber of Secrets');
  assert.equal(get(model, 'followedBy').constructor, MegamorphicModel);
});

test('.unknownProperty resolves id-matched values to external DS.models', function(assert) {
  let model = run(() => {
    return this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and the Sorcerer's Stone`,
          author: 'urn:author:3',
        },
      },
      included: [{
        id: '3',
        type: 'author',
        attributes: {
          name: `JK Rowling`,
        },
      }]
    });
  });

  assert.equal(get(model, 'author.name'), 'JK Rowling');
  assert.equal(get(model, 'author').constructor, this.Author);
});

test('.unknownProperty resolves nested-matched values as nested m3-models', function(assert) {
  let model = run(() => {
    return this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and the Sorcerer's Stone`,
          relatedToAuthor: {
            $type: 'com.example.bookstore.RelatedLink',
            value: 'urn:author:3',
            relation: 'She wrote it',
          },
          relatedToBook: {
            $type: 'com.example.bookstore.RelatedLink',
            value: 'isbn:9780439064873',
            relation: 'Next in series',
          }
        },
      },
      included: [{
        id: 'isbn:9780439064873',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and the Chamber of Secrets`,
        },
      }, {
        id: '3',
        type: 'author',
        attributes: {
          name: `JK Rowling`,
        },
      }]
    });
  });

  assert.equal(get(model, 'relatedToAuthor.relation'), 'She wrote it');
  assert.equal(get(model, 'relatedToAuthor.value.name'), 'JK Rowling');
  assert.equal(get(model, 'relatedToAuthor.value').constructor, this.Author);
  assert.equal(get(model, 'relatedToBook.relation'), 'Next in series');
  assert.equal(get(model, 'relatedToBook.value.name'), 'Harry Potter and the Chamber of Secrets');
  assert.equal(get(model, 'relatedToBook.value').constructor, MegamorphicModel);
});

test('.unknownProperty resolves arrays of id-matched values', function(assert) {
  let model = run(() => {
    return this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and the Sorcerer's Stone`,
          relatedBooks: [
            'isbn:9780439064873',
            'isbn:9780439136365',
          ]
        },
      },
      included: [{
        id: 'isbn:9780439064873',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and the Chamber of Secrets`,
        },
      }, {
        id: 'isbn:9780439136365',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and the Prisoner of Azkaban`,
        },
      }]
    });
  });

  assert.deepEqual(
    get(model, 'relatedBooks').map(x => get(x, 'name')), [
      'Harry Potter and the Chamber of Secrets',
      'Harry Potter and the Prisoner of Azkaban'
    ]);
});

test('.unknownProperty resolves arrays of nested-matched values', function(assert) {
  let model = run(() => {
    return this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and the Sorcerer's Stone`,
          chapters: [{
            name: 'The Boy Who Lived',
          }, {
            name: 'The Vanishing Glass',
          }]
        },
      },
    });
  });

  assert.deepEqual(
    get(model, 'chapters').map(x => get(x, 'name')), [
      'The Boy Who Lived',
      'The Vanishing Glass'
    ]);
});

test('.unknownProperty resolves heterogenous arrays of m3-references, ds-references and nested objects', function(assert) {
  let model = run(() => {
    return this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and the Sorcerer's Stone`,
          relatedItems: [{
            name: 'Chapter 1: The Boy Who Lived'
          }, 'isbn:9780439064873', 'urn:author:3']
        },
      },
      included: [{
        id: 'isbn:9780439064873',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and the Chamber of Secrets`,
        },
      }, {
        id: '3',
        type: 'author',
        attributes: {
          name: `JK Rowling`,
        },
      }]
    });
  });

  let relatedItems = get(model, 'relatedItems');
  assert.equal(relatedItems.length, 3, 'array has right length');
  assert.equal(get(relatedItems[0], 'name'), 'Chapter 1: The Boy Who Lived', 'array nested');
  assert.equal(get(relatedItems[1], 'name'), 'Harry Potter and the Chamber of Secrets', 'array ref-to-m3');
  assert.equal(get(relatedItems[2], 'name'), 'JK Rowling', 'array ref-to-ds.model');
});

test('.unknownProperty resolves reference arrays', function(assert) {
  let model = run(() => {
    return this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and the Sorcerer's Stone`,
          otherBooksInSeries: [
            'isbn:9780439064873',
            'isbn:9780439136365',
          ]
        },
      },
      included: [{
        id: 'isbn:9780439064873',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and the Chamber of Secrets`,
        },
      }, {
        id: 'isbn:9780439136365',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and the Prisoner of Azkaban`,
        },
      }, {
        id: 'isbn:9780439139601',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and the Goblet of Fire`,
        },
      }]
    });
  });

  let otherBooksInSeries = get(model, 'otherBooksInSeries');
  // so far just like a normal array of references
  assert.deepEqual(
    otherBooksInSeries.mapBy('id'),
    ['isbn:9780439064873', 'isbn:9780439136365'],
    'ref array looks up the referenced objects'
  );

  let chamberOfSecrets = this.store().peekRecord('com.example.bookstore.Book', 'isbn:9780439064873');
  let gobletOfFire = this.store().peekRecord('com.example.bookstore.Book', 'isbn:9780439139601');
  model.set('otherBooksInSeries', [chamberOfSecrets, gobletOfFire]);
  assert.deepEqual(
    get(model, 'otherBooksInSeries').mapBy('id'),
    ['isbn:9780439064873', 'isbn:9780439139601'],
    'ref arrays update on set'
  );
  assert.deepEqual(
    otherBooksInSeries.mapBy('id'),
    ['isbn:9780439064873', 'isbn:9780439139601'],
    'ref arrays can be "set" like DS.hasMany'
  );

  run(() => {
    this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and the Sorcerer's Stone`,
          otherBooksInSeries: [
            'isbn:9780439136365',
            'isbn:9780439358071',
          ]
        },
      },
      included: [{
        id: 'isbn:9780439358071',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and the Order of the Phoenix`,
        }
      }]
    });
  });

  assert.deepEqual(
    get(model, 'otherBooksInSeries').mapBy('id'),
    ['isbn:9780439136365', 'isbn:9780439358071'],
    'ref array properties update from server'
  );
  assert.deepEqual(
    otherBooksInSeries.mapBy('id'),
    ['isbn:9780439136365', 'isbn:9780439358071'],
    'ref arrays update in-place; treated like RecordArrays'
  );
});

test('.unknownProperty resolves null reference arrays', function(assert) {
  let model = run(() =>
    this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
        attributes: {
          otherBooksInSeries: null,
        }
      },
      included: [{
        id: 'isbn:9780439064873',
        type: 'com.example.bookstore.Book',
      }]
    })
  );

  let otherBooksInSeries = get(model, 'otherBooksInSeries');
  assert.deepEqual(otherBooksInSeries.mapBy('id'), [] , 'null ref arrays resolved');

  run(() => {
    this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
        attributes: {
          otherBooksInSeries: ['isbn:9780439064873', 'isbn:9780439136365'],
        }
      },
      included: [{
        id: 'isbn:9780439136365',
        type: 'com.example.bookstore.Book',
      }]
    });
  });

  assert.deepEqual(
    otherBooksInSeries.mapBy('id'),
    ['isbn:9780439064873', 'isbn:9780439136365'],
    'ref arrays update in-place; treated like RecordArrays'
  );
});

test('.unknownProperty supports default values', function(assert) {
  let model = run(() =>
    this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and the Sorcerer's Stone`,
          publishedIn: 'UK',
        }
      }
    })
  );

  assert.equal(get(model, 'nothing'), undefined, 'non-existent attribute returns undefind');
  assert.equal(get(model, 'hardback'), true, 'missing attribute with default returns default value');
  assert.equal(get(model, 'publishedIn'), 'UK', 'specified attributes trump defaults');
});

test('.unknownProperty supports alias values', function(assert) {
  let model = run(() =>
    this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and the Sorcerer's Stone`,
          pubDate: 'September 1989',
        }
      }
    })
  );

  let sept1989 = new Date(Date.parse('September 1989')).getTime();

  assert.equal(get(model, 'title'), `Harry Potter and the Sorcerer's Stone`, 'alias to value present');
  assert.equal(get(model, 'releaseDate').getTime(), sept1989, 'alias to value present with transform');
  assert.equal(get(model, 'cost'), undefined, 'alias to missing');
  assert.equal(get(model, 'hb'), true, 'alias to missing with default');
});

test('default values are not transformed', function(assert) {
  let model = run(() =>
    this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
      }
    })
  );

  assert.equal(get(model, 'publisher'), 'Penguin Classics', 'default value not transformed');

  run(() =>
    this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
        attributes: {
          publisher: 'Harper Collins'
        },
      }
    })
  );

  assert.equal(get(model, 'publisher'), 'Harper Collins, of course', 'specified value transformed');
});

// This is unspecified behaviour; unclear if we can do anything sane here
// TODO: 'default values are not checked for reference arrays'

test('m3 models can be created with initial properties (init prop buffering)', function(assert) {
  let model = run(() =>
    this.store().createRecord('com.example.bookstore.Book', {
      name: 'Marlborough: His Life and Times',
      isbn: '978-0226106335',
      publisher: 'University Of Chicago Press',
    })
  );

  assert.equal(get(model, 'name'), 'Marlborough: His Life and Times', 'init property set');
  assert.equal(get(model, 'isbn'), '978-0226106335', 'init property set');
  assert.equal(get(model, 'publisher'), 'University Of Chicago Press', 'init property set');
});

test('.setUnknownProperty updates data and clears simple attribute cache', function(assert) {
  let model = run(() =>
    this.store().push({
      data: {
        id: 'isbn:9780760768570',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: 'The Birth of Britain',
        }
      }
    })
  );

  assert.equal(get(model, 'title'), 'The Birth of Britain', 'initial - alias');
  assert.equal(get(model, 'name'), 'The Birth of Britain', 'initial - prop');

  set(model, 'name', 'Vol. I');

  assert.equal(get(model, 'title'), 'Vol. I', 'set prop - cached alias');
  assert.equal(get(model, 'name'), 'Vol. I', 'set prop - prop');

  assert.throws(() => {
    set(model, 'title', 'Volume I. The Birth of Britain');
  }, /You tried to set 'title' to 'Volume I. The Birth of Britain', but 'title' is an alias in 'com.example.bookstore.Book' and aliases are read-only/, 'error to set an alias');
});

test('.setUnknownProperty triggers change events', function(assert) {
  let model = run(() => {
    return this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and the Sorcerer's Stone`,
          fans: 'lots',
        },
      },
    });
  });

  let propChanges = [];
  model.addObserver('fans', (model, key) => {
    propChanges.push([model+'', key]);
  });

  // observe alias
  model.addObserver('title', (model, key) => {
    propChanges.push([model+'', key]);
  });

  set(model, 'fans', 'millions');
  // check that alias doesn't get prop changes when not requested
  set(model, 'name', 'First Book');

  assert.deepEqual(propChanges, [[model+'', 'fans']], 'change events trigger for direct props');

  propChanges.splice(0, propChanges.length);
  assert.equal(get(model, 'title'), `First Book`, 'initialize alias');
  set(model, 'name', 'Book 1');

  assert.deepEqual(propChanges, [[model+'', 'title']], 'change events trigger for aliases');
});

// TODO: '.setUnknownProperty can update belongs-to relationships'

test('DS.Models can have relationships into m3 models', function(assert) {
  let model = run(() => {
    return this.store().push({
      data: {
        id: '3',
        type: 'author',
        attributes: {
          name: 'JK Rowling',
        },
        relationships: {
          publishedBooks: {
            data: [{
              id: 'isbn:9780439708180',
              type: 'com.example.bookstore.Book',
            }]
          }
        }
      },

      included: [{
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and the Sorcerer's Stone`,
        }
      }]
    });
  });

  assert.equal(get(model, 'name'), 'JK Rowling', 'ds.model loaded');
  assert.equal(
    get(model, 'publishedBooks.firstObject.name'),
    `Harry Potter and the Sorcerer's Stone`,
    'ds.model can access m3 model via relationship'
  );
});

test('nested models are created lazily', function(assert) {
  let init = this.sinon.spy(MegamorphicModel.prototype, 'init');
  let model = run(() => {
    return this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
        attributes: {
          nextChapter: {
            name: 'The Boy Who Lived',
            nextChapter: {
              name: 'The Vanishing Glass',
            }
          },
        },
      },
    });
  });

  assert.equal(init.callCount, 1, 'initially only one model is created');

  model = run(() => {
    return this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
        attributes: {
          nextChapter: {
            name: 'The Boy Who Lived',
            nextChapter: {
              name: 'The Vanishing Glass',
              nextChapter: {
                name: 'The Letters from No One',
              },
            }
          },
        },
      },
    });
  });

  assert.equal(init.callCount, 1, 'model changes do not reify nested models');

  assert.equal(get(model, 'nextChapter.name'), 'The Boy Who Lived');
  assert.equal(init.callCount, 2, 'nested model is created lazily');

  assert.equal(get(model, 'nextChapter.name'), 'The Boy Who Lived');
  assert.equal(init.callCount, 2, 'nested model is cached');

  assert.equal(get(model, 'nextChapter.nextChapter.name'), 'The Vanishing Glass');
  assert.equal(init.callCount, 3, 'doubly nested model is created lazily');

  assert.equal(get(model, 'nextChapter.nextChapter.name'), 'The Vanishing Glass');
  assert.equal(init.callCount, 3, 'doubly nested model is cached');
});

test('attribute property changes are properly detected', function(assert) {
  let propChange = this.sinon.spy(MegamorphicModel.prototype, 'notifyPropertyChange');
  let model = run(() => {
    return this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and hmm I forget the next bit`,
        },
      },
    });
  });

  run(() => {
    return this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and the Sorcerer's Stone`,
        },
      },
    });
  });

  assert.deepEqual(zip(propChange.thisValues.map(x => x+''), propChange.args), [
    [model+'', ['name']],
  ]);
});

test('omitted attributes are treated as deleted', function(assert) {
  let propChange = this.sinon.spy(MegamorphicModel.prototype, 'notifyPropertyChange');

  let model = run(() => {
    return this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and the Sorcerer's Stone`,
          author: 'JK Rowling',
        },
      },
    });
  });

  run(() => {
    return this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
        attributes: {
          author: `JK Rowling`,
        },
      },
    });
  });

  assert.deepEqual(zip(propChange.thisValues.map(x => x+''), propChange.args), [
    [model+'', ['name']],
  ], 'omitted attributes are treated as deleted');
});

test('omitted attributes in nested models are treated as deleted', function(assert) {
  let init = this.sinon.spy(MegamorphicModel.prototype, 'init');
  let propChange = this.sinon.spy(MegamorphicModel.prototype, 'notifyPropertyChange');

  let model = run(() => {
    return this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and the Sorcerer's Stone`,
          nextChapter: {
            id: 'ch1',
            name: 'The Boy Who Lived',
            number: 0,
            nextChapter: {
              id: 'ch2',
              name: 'The Vanishing Glass',
              number: 1,
            }
          }
        },
      },
    });
  });

  assert.equal(init.callCount, 1, 'one model is initially created');
  assert.equal(propChange.callCount, 0, 'no property changes');

  let nested = get(model, 'nextChapter');
  let doubleNested = get(model, 'nextChapter.nextChapter');

  assert.equal(init.callCount, 3, 'models created lazily');

  assert.equal(get(nested, 'name'), `The Boy Who Lived`);
  assert.equal(get(doubleNested, 'name'), 'The Vanishing Glass');

  run(() => {
    return this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and the Sorcerer's Stone`,
          nextChapter: {
            id: 'ch1',
            number: 1,
            nextChapter: {
              id: 'ch2',
              number: 2,
            }
          }
        },
      },
    });
  });

  assert.deepEqual(zip(propChange.thisValues.map(x => x+''), propChange.args), [
    [nested+'', ['name']],
    [doubleNested+'', ['name']],
    [doubleNested+'', ['number']],
    [nested+'', ['number']],
  ], 'omitted attributes in nested models are deleted');

  assert.equal(get(nested, 'number'), 1);
  assert.equal(get(nested, 'name'), undefined);
  assert.equal(get(doubleNested, 'number'), 2);
  assert.equal(get(doubleNested, 'name'), undefined);
});

test('new attributes are treated as changed', function(assert) {
  let propChange = this.sinon.spy(MegamorphicModel.prototype, 'notifyPropertyChange');

  let model = run(() => {
    return this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and the Sorcerer's Stone`,
        },
      },
    });
  });

  assert.equal(get(model, 'name'), `Harry Potter and the Sorcerer's Stone`);
  assert.equal(get(model, 'chapterCount'), undefined);

  run(() => {
    return this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and the Sorcerer's Stone`,
          chapterCount: 17,
        },
      },
    });
  });

  assert.deepEqual(zip(propChange.thisValues.map(x => x+''), propChange.args), [
    [model+'', ['chapterCount']],
  ], 'new attributes are treated as changes');

  assert.equal(get(model, 'name'), `Harry Potter and the Sorcerer's Stone`);
  assert.equal(get(model, 'chapterCount'), 17);
});

test('new attributes in nested models are treated as changed', function(assert) {
  let propChange = this.sinon.spy(MegamorphicModel.prototype, 'notifyPropertyChange');

  let model = run(() => {
    return this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and the Sorcerer's Stone`,
          nextChapter: {
            name: 'The Boy Who Lived',
          }
        },
      },
    });
  });

  let nested = model.get('nextChapter');
  assert.equal(get(nested, 'name'), 'The Boy Who Lived');

  run(() => {
    return this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and the Sorcerer's Stone`,
          nextChapter: {
            name: 'The Boy Who Lived',
            number: 1,
          }
        },
      },
    });
  });

  assert.deepEqual(zip(propChange.thisValues.map(x => x+''), propChange.args), [
    [nested+'', ['number']],
  ], 'new attributes in nested models are treated as changes');
});

test('nested model attribute changes are properly detected', function(assert) {
  let init = this.sinon.spy(MegamorphicModel.prototype, 'init');
  let propChange = this.sinon.spy(MegamorphicModel.prototype, 'notifyPropertyChange');

  let model = run(() => {
    return this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and the Sorcerer's Stone`,
          number: 0,
          nextChapter: {
            name: 'The Boy Who whatever',
            number: 1,
            nextChapter: {
              name: 'The Vanishing dunno',
              number: 2,
            }
          }
        },
      },
    });
  });

  assert.equal(init.callCount, 1, 'one model is initially created');
  assert.equal(propChange.callCount, 0, 'no property changes');

  let nested = get(model, 'nextChapter');
  let doubleNested = get(model, 'nextChapter.nextChapter');

  assert.equal(init.callCount, 3, 'models created lazily');

  assert.equal(get(nested, 'name'), `The Boy Who whatever`, 'get nested.name');
  assert.equal(get(doubleNested, 'name'), 'The Vanishing dunno', 'get nested.nested.name');

  run(() => {
    return this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and the Sorcerer's Stone`,
          number: 0,
          nextChapter: {
            name: 'The Boy Who Lived',
            number: 1,
            nextChapter: {
              name: 'The Vanishing Glass',
              number: 2,
            }
          }
        },
      },
    });
  });

  assert.deepEqual(zip(propChange.thisValues.map(x => x+''), propChange.args), [
    [nested+'', ['name']],
    [doubleNested+'', ['name']],
  ], 'property changes are called for changed attributes on nested models, but not for unchanged attributes');
});

test('nested model updates null -> model', function(assert) {
  let init = this.sinon.spy(MegamorphicModel.prototype, 'init');
  let propChange = this.sinon.spy(MegamorphicModel.prototype, 'notifyPropertyChange');

  let model = run(() => {
    return this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and the Sorcerer's Stone`,
        },
      },
    });
  });

  assert.equal(get(model, 'name'), `Harry Potter and the Sorcerer's Stone`, 'property get as expected');
  assert.equal(init.callCount, 1, 'one model is initially created');

  run(() => {
    return this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and the Sorcerer's Stone`,
          nextChapter: {
            name: 'The Boy Who Lived',
          }
        },
      },
    });
  });

  assert.equal(init.callCount, 1, 'nested models are not eaagerly created from changes');
  assert.deepEqual(zip(propChange.thisValues.map(x => x+''), propChange.args), [
    [model+'', ['nextChapter']],
  ], 'nested model from null is treated as a change');

  assert.equal(get(model, 'nextChapter.name'), 'The Boy Who Lived', 'nested model attrs set');
  assert.equal(init.callCount, 2, 'nested models are lazily created');
});

test('nested model updates primitive -> model', function(assert) {
  let init = this.sinon.spy(MegamorphicModel.prototype, 'init');
  let propChange = this.sinon.spy(MegamorphicModel.prototype, 'notifyPropertyChange');

  let model = run(() => {
    return this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and the Sorcerer's Stone`,
          nextChapter: 'The Boy Who Lived'
        },
      },
    });
  });

  assert.equal(get(model, 'name'), `Harry Potter and the Sorcerer's Stone`, 'get model.property');
  assert.equal(get(model, 'nextChapter'), `The Boy Who Lived`, 'get model.nested');
  assert.equal(init.callCount, 1, 'one model is initially created');

  run(() => {
    return this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and the Sorcerer's Stone`,
          nextChapter: {
            name: 'The Boy Who Lived',
          }
        },
      },
    });
  });

  assert.equal(init.callCount, 1, 'nested models are not eaagerly created from changes');
  assert.deepEqual(zip(propChange.thisValues.map(x => x+''), propChange.args), [
    [model+'', ['nextChapter']],
  ], 'nested model from null is treated as a change');

  assert.equal(get(model, 'nextChapter.name'), 'The Boy Who Lived', 'get model.nested.name');
  assert.equal(init.callCount, 2, 'nested models are lazily created');
});

test('nested model updates model -> null (model reified)', function(assert) {
  let init = this.sinon.spy(MegamorphicModel.prototype, 'init');
  let propChange = this.sinon.spy(MegamorphicModel.prototype, 'notifyPropertyChange');

  let model = run(() => {
    return this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and the Sorcerer's Stone`,
          nextChapter: {
            name: 'The Boy Who Lived',
          }
        },
      },
    });
  });

  assert.equal(get(model, 'nextChapter.name'), `The Boy Who Lived`, 'get model.nested');
  assert.equal(init.callCount, 2, 'nested models created');

  run(() => {
    return this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and the Sorcerer's Stone`,
        },
      },
    });
  });

  assert.equal(init.callCount, 2, 'no additional models created');
  assert.deepEqual(zip(propChange.thisValues.map(x => x+''), propChange.args), [
    [model+'', ['nextChapter']],
  ], 'nested model -> null is a change');

  assert.equal(get(model, 'nextChapter.name'), undefined, 'nested model cleared');
});

test('nested model updates model -> primitive', function(assert) {
  let init = this.sinon.spy(MegamorphicModel.prototype, 'init');
  let propChange = this.sinon.spy(MegamorphicModel.prototype, 'notifyPropertyChange');

  let model = run(() => {
    return this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and the Sorcerer's Stone`,
          nextChapter: {
            name: 'The Boy Who Lived',
          }
        },
      },
    });
  });

  assert.equal(get(model, 'nextChapter.name'), `The Boy Who Lived`, 'get model.nested');
  assert.equal(init.callCount, 2, 'nested models created');

  run(() => {
    return this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and the Sorcerer's Stone`,
          nextChapter: 'The Boy Who Lived',
        },
      },
    });
  });

  assert.equal(init.callCount, 2, 'no additional models created');
  assert.deepEqual(zip(propChange.thisValues.map(x => x+''), propChange.args), [
    [model+'', ['nextChapter']],
  ], 'nested model -> primitive is a change');

  assert.equal(get(model, 'nextChapter'), 'The Boy Who Lived', 'nested model -> primitive');
});

test('nested model updates model -> null (model inert)', function(assert) {
  let init = this.sinon.spy(MegamorphicModel.prototype, 'init');
  let propChange = this.sinon.spy(MegamorphicModel.prototype, 'notifyPropertyChange');

  let model = run(() => {
    return this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and the Sorcerer's Stone`,
          nextChapter: {
            name: 'The Boy Who Lived',
          }
        },
      },
    });
  });

  assert.equal(init.callCount, 1, 'one model initially created');

  run(() => {
    return this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and the Sorcerer's Stone`,
        },
      },
    });
  });

  assert.equal(init.callCount, 1, 'no additional models created');
  assert.deepEqual(zip(propChange.thisValues.map(x => x+''), propChange.args), [
    [model+'', ['nextChapter']],
  ], 'nested model -> null is a change');

  assert.equal(get(model, 'nextChapter.name'), undefined, 'nested model not set');
  assert.equal(init.callCount, 1, 'no additional models created');
});

test('nested model updates (model -> model) no changes', function(assert) {
  let init = this.sinon.spy(MegamorphicModel.prototype, 'init');
  let propChange = this.sinon.spy(MegamorphicModel.prototype, 'notifyPropertyChange');

  let model = run(() => {
    return this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and the Sorcerer's Stone`,
          nextChapter: {
            name: 'The Boy Who Lived',
            number: 1,
          }
        },
      },
    });
  });

  assert.equal(init.callCount, 1, 'one model initially created');

  run(() => {
    return this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and the Sorcerer's Stone`,
          nextChapter: {
            name: 'The Boy Who Lived',
            number: 1,
          }
        },
      },
    });
  });

  assert.equal(init.callCount, 1, 'no additional models created');
  assert.deepEqual(zip(propChange.thisValues.map(x => x+''), propChange.args), [
    [model+'', ['nextChapter']],
  ], 'nested pojo -> pojo change even if hte values are deep equal');
});

test('nested array attribute changes are properly detected', function(assert) {
  let init = this.sinon.spy(MegamorphicModel.prototype, 'init');
  let propChange = this.sinon.spy(MegamorphicModel.prototype, 'notifyPropertyChange');

  let model = run(() => {
    return this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and the Sorcerer's Stone`,
          chapters: [{
            name: 'The Boy Who Lived',
          }, {
            name: 'The Vanishing Glass',
          }]
        },
      },
    });
  });

  let childModel = get(model, 'chapters')[1];
  assert.equal(init.callCount, 3, 'nested models in arrays are eagerly reified');

  run(() => {
    return this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
        attributes: {
          name: `Harry Potter and the Sorcerer's Stone`,
          chapters: [{
            name: 'The Boy Who Lived',
          }, {
            name: 'The Vanishing Glass',
          }]
        },
      },
    });
  });

  assert.equal(init.callCount, 3, 'no additional models created');
  assert.deepEqual(zip(propChange.thisValues.map(x => x+''), propChange.args), [
    [model+'', ['chapters']],
  ], 'nested array -> array change even if the values are deep equal');

  assert.notEqual(get(model, 'chapters')[1], childModel, 'previous nested models in arrays are not re-used');
  assert.equal(init.callCount, 5, 'nested models in arrays are not re-used');
});

test(`.serialize serializers with the user's -ember-m3 serializer`, function(assert) {
  assert.expect(4);

  this.register('serializer:-ember-m3', Ember.Object.extend({
    serialize(snapshot, options) {
      assert.deepEqual(options, { some: 'options' }, 'options are passed through to serialize');
      assert.equal(snapshot.attr('name'), 'The Winds of Winter', 'attr - name');
      assert.equal(snapshot.attr('estimatedPubDate'), 'January 2622', 'attr - estimatedPubDate');

      let eachAttrCBCalls = [];
      snapshot.eachAttribute(key => eachAttrCBCalls.push(key));

      assert.deepEqual(eachAttrCBCalls.sort(), ['estimatedPubDate', 'name'], 'eachAttribute iterates data');
    }
  }));

  let model = run(() => {
    return this.store().push({
      data: {
        id: 1,
        type: 'com.example.bookstore.Book',
        attributes: {
          name: 'The Winds of Winter',
          estimatedPubDate: 'January 2622',
        }
      }
    });
  });

  return model.serialize({ some: 'options' });
});

test('.save saves via the store', function(assert) {
  assert.expect(6);

  this.register('adapter:-ember-m3', Ember.Object.extend({
    updateRecord(store, type, snapshot) {
      assert.equal(snapshot.record.get('isSaving'), true, 'record is saving');
      return Promise.resolve({
        data: {
          id: 1,
          type: 'com.example.bookstore.Book',
          attributes: {
            name: 'The Winds of Winter',
            estimatedRating: '11/10',
          }
        }
      });
    },
  }));

  let model = run(() => {
    return this.store().push({
      data: {
        id: 1,
        type: 'com.example.bookstore.Book',
        attributes: {
          name: 'The Winds of Winter',
          estimatedPubDate: 'January 2622',
        }
      }
    });
  });

  assert.equal(model.get('isDirty'), false, 'initially model clean');
  assert.equal(model.get('isSaving'), false, 'initially model not saving');
  model.set('estimatedPubDate', '2231?');
  assert.equal(model.get('isDirty'), false, 'no dirty tracking support');

  return run(() =>
    model.save().then(() => {
      assert.equal(model.get('isSaving'), false, 'model done saving');
      assert.deepEqual(model._internalModel._data, {
        name: 'The Winds of Winter',
        estimatedRating: '11/10',
      }, 'data post save resolve');
    })
  );
});

test('.reload calls findRecord with reload: true', function(assert) {
  assert.expect(2);

  this.register('adapter:-ember-m3', Ember.Object.extend({
    findRecord(store, type, id, snapshot) {
      // TODO: this is annoying but name normalization means we get the wrong
      // model name in snapshots.  Should fix this upstream by dropping name
      // normalization.  See #11
      assert.equal(snapshot.modelName, 'com.example.bookstore.book', 'snapshot.modelName');
      assert.equal(id, '1', 'findRecord(id)');
      return Promise.resolve({
        data: {
          id: 1,
          type: 'com.example.bookstore.Book',
          attributes: {
            name: 'The Winds of Winter',
          }
        }
      });
    },
  }));

  let model = run(() => {
    return this.store().push({
      data: {
        id: 1,
        type: 'com.example.bookstore.book',
        attributes: {
          name: 'The Winds of Winter',
        }
      }
    });
  });

  return run(() => model.reload());
});

test('.deleteRecord works', function(assert) {
  assert.expect(2);

  this.register('adapter:-ember-m3', Ember.Object.extend({
    deteRecord() {
      assert.ok(false, 'Did not make it to adapter');
    },
  }));

  let model = run(() => {
    return this.store().push({
      data: {
        id: 1,
        type: 'com.example.bookstore.Book',
        attributes: {
          name: 'The Winds of Winter',
        }
      }
    });
  });

  assert.equal(model.get('isDeleted'), false, 'not initially deleted');
  model.deleteRecord();
  assert.equal(model.get('isDeleted'), true, 'model deleted');
});

test('.destroyRecord works', function(assert) {
  assert.expect(4);

  this.register('adapter:-ember-m3', Ember.Object.extend({
    deleteRecord(store, type, snapshot) {
      assert.equal(snapshot.record.get('isDeleted'), true, 'model is deleted');
      return Promise.resolve();
    },
  }));

  let model = run(() => {
    return this.store().push({
      data: {
        id: 1,
        type: 'com.example.bookstore.Book',
        attributes: {
          name: 'The Winds of Winter',
        }
      }
    });
  });

  assert.equal(this.store().hasRecordForId('com.example.bookstore.book', '1'), true, 'record in identity map');
  assert.equal(model.get('isDeleted'), false, 'not initially deleted');
  return run(() =>
    model.destroyRecord().
    then(() => model.unloadRecord()).
    then(() => {
      assert.equal(this.store().hasRecordForId('com.example.bookstore.book', '1'), false, 'gone from identity map');
    })
  );
});

test('.rollbackAttributes resets state from dirty', function(assert) {
  let model = run(() => {
    return this.store().push({
      data: {
        id: 1,
        type: 'com.example.bookstore.Book',
        attributes: {
          name: 'The Winds of Winter',
        }
      }
    });
  });

  model.set('name', 'Some other book');
  model.rollbackAttributes();

  assert.equal(model.get('currentState.stateName'), 'root.loaded.saved', 'after rolling back model.state loaded.saved');
  assert.deepEqual(model._internalModel._data, {
    // We do not error, but we also do not actually support rolling back
    // attributes
    name: 'Some other book',
  }, 'rollbackAttributes does not alter _data');
});

test('store.findRecord', function(assert) {
  assert.expect(5);

  this.register('adapter:-ember-m3', Ember.Object.extend({
    findRecord(store, modelClass, id, snapshot) {
      // TODO: this is annoying but name normalization means we get the wrong
      // model name in snapshots.  Should fix this upstream by dropping name
      // normalization.  See #11
      assert.equal(snapshot.modelName, 'com.example.bookstore.book', 'snapshot.modelName');
      assert.equal(modelClass, MegamorphicModel);
      assert.equal(id, 'isbn:9780439708180', 'findRecord(id)');

      return Promise.resolve({
        data: {
          id: 'isbn:9780439708180',
          type: 'com.example.bookstore.Book',
        }
      });
    },
  }));

  return run(() =>
    this.store().
    findRecord('com.example.bookstore.Book', 'isbn:9780439708180').
    then(model => {
      assert.equal(model.get('id'), 'isbn:9780439708180', 'model.id');
      assert.equal(model.constructor, MegamorphicModel, 'model.constructor');
    })
  );
});

test('store.deleteRecord', function(assert) {
  let model = run(() =>
    this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
      }
    })
  );

  assert.equal(this.store().hasRecordForId('com.example.bookstore.Book', 'isbn:9780439708180'), true, 'model present');
  run(() => {
    this.store().deleteRecord(model);
    this.store().unloadRecord(model);
  });
  assert.equal(this.store().hasRecordForId('com.example.bookstore.Book', 'isbn:9780439708180'), false, 'model gone');

  assert.equal(model.get('isDestroyed'), true, 'model.isDestroyed');
});

test('store.findAll', function(assert) {
  assert.expect(4);

  this.register('adapter:-ember-m3', Ember.Object.extend({
    shouldReloadAll() { return true; },

    findAll(store, modelClass) {
      assert.equal(modelClass, MegamorphicModel);

      return Promise.resolve({
        data: [{
          id: 'isbn:9780439708180',
          type: 'com.example.bookstore.book',
        }, {
          id: 'isbn:9780439064873',
          type: 'com.example.bookstore.book',
        }]
      });
    },
  }));

  return run(() =>
    this.store().
    findAll('com.example.bookstore.book').
    then(models => {
      assert.deepEqual(models.mapBy('id'), ['isbn:9780439708180', 'isbn:9780439064873'], 'models.[id]');
      assert.deepEqual(models.mapBy('constructor'), [MegamorphicModel, MegamorphicModel], 'models.[constructor]');

      this.store().push({
        data: {
          id: 'isbn:9780439136365',
          type: 'com.example.bookstore.book',
        },
      });

      assert.deepEqual(models.mapBy('id'), ['isbn:9780439708180', 'isbn:9780439064873'], 'models.[id]');
    })
  );
});

test('store.query', function(assert) {
  assert.expect(5);

  this.register('adapter:-ember-m3', Ember.Object.extend({
    shouldReloadAll() { return true; },

    query(store, modelClass, query /*, recordArray */) {
      assert.equal(modelClass, MegamorphicModel, 'modelClass arg');
      assert.deepEqual(query, { author: 'JK Rowling' }, 'query arg');

      return Promise.resolve({
        data: [{
          id: 'isbn:9780439708180',
          type: 'com.example.bookstore.book',
        }, {
          id: 'isbn:9780439064873',
          type: 'com.example.bookstore.book',
        }]
      });
    },
  }));

  return run(() =>
    this.store().
    query('com.example.bookstore.book', { author: 'JK Rowling' }).
    then(models => {
      assert.deepEqual(models.mapBy('id'), ['isbn:9780439708180', 'isbn:9780439064873'], 'models.[id]');
      assert.deepEqual(models.mapBy('constructor'), [MegamorphicModel, MegamorphicModel], 'models.[constructor]');

      this.store().push({
        data: {
          id: 'isbn:9780439136365',
          type: 'com.example.bookstore.book',
        },
      });

      assert.deepEqual(models.mapBy('id'), ['isbn:9780439708180', 'isbn:9780439064873'], 'models.[id]');
    })
  );
});

test('store.queryRecord', function(assert) {
  assert.expect(4);

  this.register('adapter:-ember-m3', Ember.Object.extend({
    shouldReloadAll() { return true; },

    queryRecord(store, modelClass, query) {
      assert.equal(modelClass, MegamorphicModel, 'modelClass arg');
      assert.deepEqual(query, { author: 'JK Rowling' }, 'query arg');

      return Promise.resolve({
        data: {
          id: 'isbn:9780439708180',
          type: 'com.example.bookstore.book',
        },
      });
    },
  }));

  return run(() =>
    this.store().
    queryRecord('com.example.bookstore.book', { author: 'JK Rowling' }).
    then(model => {
      assert.equal(model.get('id'), 'isbn:9780439708180', 'model.id');
      assert.equal(model.constructor, MegamorphicModel, 'model.constructor');
    })
  );
});

test('store.unloadRecord', function(assert) {
  run(() => {
    this.store().push({
      data: {
        id: 'isbn:9780439136365',
        type: 'com.example.bookstore.book',
      },
    });

    assert.equal(this.store().hasRecordForId('com.example.bookstore.book', 'isbn:9780439136365'), true, 'book in store');
    let model = this.store().peekRecord('com.example.bookstore.book', 'isbn:9780439136365');
    this.store().unloadRecord(model);
  });

  assert.equal(this.store().hasRecordForId('com.example.bookstore.book', 'isbn:9780439136365'), false, 'book unloaded');
});

test('store.getReference', function(assert) {
  assert.expect(10);

  this.register('adapter:-ember-m3', Ember.Object.extend({
    findRecord(store, modelClass, id, snapshot) {
      assert.equal(snapshot.modelName, 'com.example.bookstore.book', 'snapshot.modelName');
      assert.equal(modelClass, MegamorphicModel);
      assert.equal(id, 'isbn:9780439708180', 'findRecord(id)');

      return Promise.resolve({
        data: {
          id: 'isbn:9780439708180',
          type: 'com.example.bookstore.Book',
        }
      });
    },
  }));

  run(() => {
    let ref = this.store().getReference('com.example.bookstore.book', 'isbn:9780439708180');

    return ref.load().
      then(model => {
        assert.deepEqual(model.get('id'), 'isbn:9780439708180', 'ref.load(x => x.id)');
        assert.deepEqual(model.constructor, MegamorphicModel, 'ref.load(x => x.constructor)');

        return ref.reload();
      }).then(model => {
        assert.deepEqual(model.get('id'), 'isbn:9780439708180', 'ref.reload(x => x.id)');
        assert.deepEqual(model.constructor, MegamorphicModel, 'ref.reload(x => x.constructor)');
      });
  });
});

test('store.hasRecordForId', function(assert) {
  return run(() => {
    this.store().push({
      data: {
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.Book',
      }
    });

    assert.equal(this.store().hasRecordForId('com.example.bookstore.Book', 'isbn:9780439708180'), true, 'store has model');
    assert.equal(this.store().hasRecordForId('com.example.bookstore.Book', 'isbn:12345'), false, 'store does not have model');
  });
});

test('store.modelFor', function(assert) {
  let bookModel = this.store().modelFor('com.example.bookstore.Book');
  let chapterModel = this.store().modelFor('com.example.bookstore.Chapter');
  let authorModel = this.store().modelFor('author');

  assert.equal(authorModel, this.Author, 'modelFor DS.Model');
  assert.equal(bookModel, MegamorphicModel, 'modelFor schema-matching');
  assert.equal(chapterModel, MegamorphicModel, 'modelFor other schema-matching');
});

// TODO: peekAll should live update; see #7 (and also #11)
test('store.peekAll', function(assert) {
  return run(() => {
    this.store().push({
      data: [{
        id: 'isbn:9780439708180',
        type: 'com.example.bookstore.book',
      }, {
        id: 'isbn:9780439064873',
        type: 'com.example.bookstore.book',
      }]
    });

    let models = this.store().peekAll('com.example.bookstore.book');
    assert.deepEqual(models.mapBy('id'), ['isbn:9780439708180', 'isbn:9780439064873'], 'store.peekAll().[id]');

    this.store().push({
      data: {
        id: 'isbn:9780439136365',
        type: 'com.example.bookstore.book',
      },
    });

    assert.deepEqual(models.mapBy('id'), ['isbn:9780439708180', 'isbn:9780439064873'], 'peekAll.[id] does not live update');

    this.store().push({
      data: {
        id: 'isbn:9780439136365',
        type: 'com.example.bookstore.chapter',
      },
    });

    assert.deepEqual(models.mapBy('id'), ['isbn:9780439708180', 'isbn:9780439064873'], 'peekAll.[id] does not live update');
  });
});
