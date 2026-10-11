import React, { useState } from 'react';

export default function TestCreate() {
  const [title, setTitle] = useState('');
  const [classroomId, setClassroomId] = useState('');

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await fetch('/api/tests', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title,
        classroomId,
        startTime: new Date().toISOString(),
        endTime: new Date(Date.now() + 3600000).toISOString()
      })
    });
    alert('Test created!');
  };

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Create New Test</h1>
      <form onSubmit={handleCreate} className="flex flex-col gap-4 max-w-sm">
        <label className="flex flex-col">
          Test Title:
          <input type="text" className="border p-2" value={title} onChange={e => setTitle(e.target.value)} required />
        </label>
        <label className="flex flex-col">
          Classroom ID:
          <input type="text" className="border p-2" value={classroomId} onChange={e => setClassroomId(e.target.value)} required />
        </label>
        <button type="submit" className="bg-blue-500 text-white p-2 rounded">Create</button>
      </form>
    </div>
  );
}
