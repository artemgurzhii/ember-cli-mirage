import Factory from './factory';
import trait from './trait';
import association from './association';
import Model from './orm/model';
import Collection from './orm/collection';
import Serializer from './serializer';
import RestSerializer from './serializers/rest-serializer';
import HasMany from './orm/associations/has-many';
import BelongsTo from './orm/associations/belongs-to';
import IdentityManager from './identity-manager';

/**
  @hide
*/
function hasMany(...args) {
  return new HasMany(...args);
}

/**
  @hide
*/
function belongsTo(...args) {
  return new BelongsTo(...args);
}

export {
  Factory,
  trait,
  association,
  Model,
  Collection,
  Serializer,
  RestSerializer,
  hasMany,
  belongsTo,
  IdentityManager
};

export default {
  Factory,
  Response,
  hasMany,
  belongsTo
};
