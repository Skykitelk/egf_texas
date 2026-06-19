"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.md5File = md5File;
exports.md5Buffer = md5Buffer;
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
function md5File(filePath) {
    const buffer = fs_1.default.readFileSync(filePath);
    return crypto_1.default.createHash('md5').update(buffer).digest('hex');
}
function md5Buffer(buffer) {
    return crypto_1.default.createHash('md5').update(buffer).digest('hex');
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWQ1LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc291cmNlL3V0aWxzL21kNS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7OztBQUdBLDBCQUdDO0FBRUQsOEJBRUM7QUFWRCxvREFBNEI7QUFDNUIsNENBQW9CO0FBRXBCLFNBQWdCLE9BQU8sQ0FBQyxRQUFnQjtJQUNwQyxNQUFNLE1BQU0sR0FBRyxZQUFFLENBQUMsWUFBWSxDQUFDLFFBQVEsQ0FBQyxDQUFDO0lBQ3pDLE9BQU8sZ0JBQU0sQ0FBQyxVQUFVLENBQUMsS0FBSyxDQUFDLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQztBQUNqRSxDQUFDO0FBRUQsU0FBZ0IsU0FBUyxDQUFDLE1BQWM7SUFDcEMsT0FBTyxnQkFBTSxDQUFDLFVBQVUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDO0FBQ2pFLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgY3J5cHRvIGZyb20gJ2NyeXB0byc7XG5pbXBvcnQgZnMgZnJvbSAnZnMnO1xuXG5leHBvcnQgZnVuY3Rpb24gbWQ1RmlsZShmaWxlUGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBidWZmZXIgPSBmcy5yZWFkRmlsZVN5bmMoZmlsZVBhdGgpO1xuICAgIHJldHVybiBjcnlwdG8uY3JlYXRlSGFzaCgnbWQ1JykudXBkYXRlKGJ1ZmZlcikuZGlnZXN0KCdoZXgnKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG1kNUJ1ZmZlcihidWZmZXI6IEJ1ZmZlcik6IHN0cmluZyB7XG4gICAgcmV0dXJuIGNyeXB0by5jcmVhdGVIYXNoKCdtZDUnKS51cGRhdGUoYnVmZmVyKS5kaWdlc3QoJ2hleCcpO1xufVxuIl19