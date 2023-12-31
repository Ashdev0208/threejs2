import { Vector3 } from 'v3d';

let vector3;

const getDirectionVector = (light, camera, directionVector) => {

    vector3 ||= new Vector3();

    directionVector.setFromMatrixPosition(light.matrixWorld);
    vector3.setFromMatrixPosition(light.target.matrixWorld);
    directionVector.sub(vector3);
    directionVector.transformDirection(camera.matrixWorldInverse);

}

export default getDirectionVector;
