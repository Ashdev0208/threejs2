import UniformNode from '../core/UniformNode.js';
import { NodeUpdateType } from '../core/constants.js';

class TimerNode extends UniformNode {

    static LOCAL = 'local';
    static GLOBAL = 'global';
    static DELTA = 'delta';
    static FRAME = 'frame';

    constructor(scope = TimerNode.LOCAL, scale = 1, value = 0) {

        super(value);

        this.scope = scope;
        this.scale = scale;

        this.updateType = NodeUpdateType.FRAME;

    }
/*
    @TODO:
    getNodeType(builder) {

        const scope = this.scope;

        if (scope === TimerNode.FRAME) {

            return 'uint';

        }

        return 'float';

    }
*/
    update(frame) {

        const scope = this.scope;
        const scale = this.scale;

        if (scope === TimerNode.LOCAL) {

            this.value += frame.deltaTime * scale;

        } else if (scope === TimerNode.DELTA) {

            this.value = frame.deltaTime * scale;

        } else if (scope === TimerNode.FRAME) {

            this.value = frame.frameId;

        } else {

            // global

            this.value = frame.time * scale;

        }

    }

    serialize(data) {

        super.serialize(data);

        data.scope = this.scope;
        data.scale = this.scale;

    }

    deserialize(data) {

        super.deserialize(data);

        this.scope = data.scope;
        this.scale = data.scale;

    }

}

export default TimerNode;
