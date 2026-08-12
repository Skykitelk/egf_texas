import { _decorator, Component, Node, director } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('ManualLoadScene')
export class ManualLoadScene extends Component {
    
    onBtnBack () {
        director.loadScene('start-scene');
    }
}

