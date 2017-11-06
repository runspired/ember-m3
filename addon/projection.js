import MegamorphicModel from './model';

export const PROJECTION_TYPE_NAMESPACE = 'projection@';

export function isProjectionClassPath(classPath) {
  return /\.projection\./i.test(classPath);
}

export function isProjectionModelName(modelName) {
  return modelName.indexOf(PROJECTION_TYPE_NAMESPACE) === 0;
}

export default class ProjectionModel extends MegamorphicModel {
  static get isProjection() {
    return true;
  }

  static toString() {
    return 'ProjectionModel';
  }

  static get klass() {
    return ProjectionModel;
  }

  toString() {
    return `<ProjectionModel:${this.id}>`;
  }
}

export const ProjectionFactory = {
  class: ProjectionModel,
  create(props) {
    return new ProjectionModel(props);
  },
};
