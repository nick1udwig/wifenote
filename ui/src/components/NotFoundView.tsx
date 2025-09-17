import React from 'react';
import './NotFoundView.css';

interface NotFoundViewProps {
  error?: string;
}

const NotFoundView: React.FC<NotFoundViewProps> = ({ error }) => {
  return (
    <div className="not-found">
      <div className="not-found-content">
        <h1>Error</h1>
        <p>{error || "The note you are looking for does not exist or you do not have permission to view it."}</p>
      </div>
    </div>
  );
};

export default NotFoundView;