import React, { useState, useEffect } from 'react';

export default function ExamPage() {
  const [answers, setAnswers] = useState({});
  const testId = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '').get('testId');

  useEffect(() => {
    // Optionally load existing draft from backend here
  }, []);

  const saveDraft = async () => {
    await fetch('/api/submissions/save', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ testId, answers })
    });
    alert('Draft saved');
  };

  const submitExam = async () => {
    const res = await fetch('/api/submissions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ testId, answers })
    });
    
    if (res.ok) {
      alert('Exam submitted successfully');
      window.location.href = '/student/StudentDashboard';
    } else {
      const data = await res.json();
      alert(`Error: ${data.error}`);
    }
  };

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Active Exam</h1>
      <p className="mb-4">Timer running. Server will reject submissions after time is up.</p>
      
      <div className="mb-4">
        <label>
          Q1: What is 2 + 2?
          <input type="text" className="border p-2 ml-2 block mt-1" onChange={(e) => setAnswers({...answers, q1: e.target.value})} />
        </label>
      </div>

      <button onClick={saveDraft} className="bg-yellow-500 text-white p-2 rounded mr-4">Save Draft</button>
      <button onClick={submitExam} className="bg-red-500 text-white p-2 rounded">Final Submit Exam</button>
    </div>
  );
}
