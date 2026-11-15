# Git Graph Web Viewer (PRO Edition)

Ứng dụng trực quan hóa lịch sử commit Git (Git DAG Topology) trên nền tảng **Web**, hiển thị biểu đồ phân nhánh trực quan, hỗ trợ xem chi tiết commit và trình đọc **Git Diff** trực tiếp trên trình duyệt.

## 🌟 Tính năng nổi bật

- 🌳 **Commit Topology DAG Graph siêu nét**:
  - Đường line phân nhánh được vẽ bằng SVG nét to, đậm (4px) và uốn lượn mượt mà.
  - Mỗi nhánh sở hữu một dải màu Neon huỳnh quang riêng biệt (`#00f0ff`, `#ff2a85`, `#ffb800`, `#00ff85`, `#bd00ff`).
  - Node commit phát sáng nổi bật với vòng hào quang và tâm trắng tinh tế.
  - Nhãn nhánh (`main`, `develop`, `origin/remote`, `tags`) được bo tròn dạng pill badge chuyên nghiệp.
- 🔍 **Commit Inspector & Full Diff Viewer**:
  - Click vào bất kỳ commit nào để xem: Hash, Author, Thời gian, Subject.
  - Danh sách các file bị thay đổi kèm badge trạng thái: `M` (Modified), `A` (Added), `D` (Deleted).
  - Trình xem Git Diff màu: dòng thêm mới màu xanh `+`, dòng xóa màu đỏ `-`, hunk `@@`.
- ⚡ **Tìm kiếm & Bộ lọc tức thì**: Tìm kiếm commit theo Subject, Hash hoặc Tác giả.
- 🔄 **Hành động Git**: Hỗ trợ nút **Fetch** từ remotes và **Refresh** tải lại đồ thị tức thì.
- 💻 **Không cần cài đặt thư viện**: Sử dụng Node.js thuần (Zero dependencies ngoài `git` có sẵn trên máy).

## 🚀 Khởi chạy ứng dụng

```bash
npm start
# hoặc chạy chế độ auto-reload khi phát triển:
npm run dev
```

Mở trình duyệt tại: [http://localhost:4173](http://localhost:4173)

## 📌 Cách sử dụng

- Mặc định ứng dụng sẽ đọc Git repository ở thư mục hiện tại.
- Bạn có thể nhập bất kỳ đường dẫn repository nào khác trên máy vào ô tìm kiếm ở thanh trên cùng và nhấn **Tải Repo**.
