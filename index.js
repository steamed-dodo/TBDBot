"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class MenuBuilder {
    constructor(data) {
        if (data) {
            this.data = data;
        }
        else {
            this.data = {
                title: "",
                color: "",
            };
        }
    }
    data;
    /**
     * setTitle
    */
    setTitle(title) {
        this.data.title = title;
        return this;
    }
    /**
     * setColor
    */
    setColor(color) {
        this.data.color = color;
        return this;
    }
}
const menu = new MenuBuilder().setColor("white").setTitle("hello");
//# sourceMappingURL=index.js.map