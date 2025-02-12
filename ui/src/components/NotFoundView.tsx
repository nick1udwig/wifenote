import React from 'react';
import './NotFoundView.css';

const NotFoundView: React.FC = () => {
  return (
    <div className="not-found">
      <div className="not-found-content">
        <h1>No note or unauthorized</h1>
        <p>The note you're looking for doesn't exist or you don't have permission to view it.</p>
      </div>
    </div>
  );
};

export default NotFoundView;