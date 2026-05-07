export default function ImportModal({ sourceNode, conversationId, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-96 shadow-xl">
        <p>Import modal placeholder</p>
        <button onClick={onClose} className="mt-2 text-sm text-gray-600">Close</button>
      </div>
    </div>
  );
}
