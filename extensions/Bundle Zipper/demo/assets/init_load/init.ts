import { _decorator, Component, Node, director } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('InitLoadScene')
export class InitLoadScene extends Component {
    
    onBtnBack () {
        director.loadScene('start-scene');
    }
}

