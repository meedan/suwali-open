import { useEffect, useRef, useState } from "react";

export function usePhotoUploader(initialFile: File | null = null) {
  const [selectedFile, setSelectedFile] = useState<File | null>(initialFile);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(selectedFile);
    setPreviewUrl(objectUrl);
    
    return () => URL.revokeObjectURL(objectUrl);
  }, [selectedFile]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const handleReplacePhotoClick = () => {
    fileInputRef.current?.click();
  };

  const resetPhoto = () => {
    setSelectedFile(null);
    setPreviewUrl(null);
  };

  return {
    selectedFile,
    previewUrl,
    fileInputRef,
    handleFileChange,
    handleReplacePhotoClick,
    resetPhoto,
  };
}
