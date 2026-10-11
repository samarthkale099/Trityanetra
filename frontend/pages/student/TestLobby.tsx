import React, { useState } from 'react';

export default function TestLobby() {
  const [testId, setTestId] = useState('mock-id');

  const enterExam = async () => {
    const res = await fetch(`/api/tests/${testId}/entry`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    });
    if (res.ok) {
      window.location.href = `/student/ExamPage?testId=${testId}`;
    } else {
      const data = await res.json();
      alert(`Error: ${data.error}`);
    }
  };

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Test Lobby</h1>
      <p>Waiting for the test window to open...</p>
      <input type="text" value={testId} onChange={e => setTestId(e.target.value)} className="border p-2 block my-2" placeholder="Test ID" />
      <button onClick={enterExam} className="bg-green-500 text-white p-2 rounded mt-4">Enter Exam</button>
    </div>
  );
}
