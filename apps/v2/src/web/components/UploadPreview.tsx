interface UploadFile {
  id: string;
  name: string;
  size: string;
  url?: string;
}

interface UploadPreviewProps {
  files: UploadFile[];
  onRemove?: (id: string) => void;
}

export function UploadPreview({ files, onRemove }: UploadPreviewProps) {
  if (files.length === 0) return <div className="table-empty">暂无上传文件</div>;
  return (
    <div className="ui-upload-list">
      {files.map((file) => (
        <div className="ui-upload-item" key={file.id}>
          <div className="ui-upload-thumb">{file.url ? <img src={file.url} alt="" /> : '📄'}</div>
          <div className="ui-upload-meta"><strong>{file.name}</strong><span>{file.size}</span></div>
          {onRemove && (
            <button type="button" className="ui-upload-remove" onClick={() => onRemove(file.id)} aria-label={`移除 ${file.name}`}>×</button>
          )}
        </div>
      ))}
    </div>
  );
}
