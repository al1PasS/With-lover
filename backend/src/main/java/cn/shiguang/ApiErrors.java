package cn.shiguang;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.http.*;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;
import java.util.*;

@RestControllerAdvice
class ApiErrors {
 record Error(String code,String message,String requestId) {}
 static final class MusicRangeException extends RuntimeException {
  final long size;
  MusicRangeException(long size) { this.size=size; }
 }
 private Error error(String code,String message){return new Error(code,message,UUID.randomUUID().toString());}
 @ExceptionHandler(ResponseStatusException.class)
 ResponseEntity<Error> status(ResponseStatusException e){return ResponseEntity.status(e.getStatusCode()).body(error("REQUEST_REJECTED",e.getReason()==null?"记录不存在或不可访问":e.getReason()));}
 @ExceptionHandler(MaxUploadSizeExceededException.class)
 ResponseEntity<Error> uploadLimit(MaxUploadSizeExceededException e,HttpServletRequest request){
  String message=AlbumUploadFilter.isPhotoUpload(request)
   ? "单张照片不能超过 10 MB，每批请控制在 22 MiB 以内"
   : "单个文件不能超过 20 MiB，请缩小文件后重试";
  return ResponseEntity.status(413).body(error("UPLOAD_TOO_LARGE",message));
 }
 @ExceptionHandler(MusicRangeException.class)
 ResponseEntity<Error> range(MusicRangeException e){return ResponseEntity.status(416).header(HttpHeaders.CONTENT_RANGE,"bytes */"+e.size).header(HttpHeaders.ACCEPT_RANGES,"bytes").header(HttpHeaders.CACHE_CONTROL,"private, no-store").body(error("RANGE_NOT_SATISFIABLE","请求的音乐字节范围无效"));}
 @ExceptionHandler({HttpMessageNotReadableException.class,MissingServletRequestPartException.class})
 ResponseEntity<Error> malformed(Exception e){return ResponseEntity.badRequest().body(error("VALIDATION_ERROR","请求内容无效或缺少必填文件"));}
 @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
 ResponseEntity<Error> mediaType(Exception e){return ResponseEntity.status(415).body(error("UNSUPPORTED_MEDIA_TYPE","不支持此请求内容类型"));}
 @ExceptionHandler(MethodArgumentNotValidException.class)
 ResponseEntity<Error> validation(MethodArgumentNotValidException e){return ResponseEntity.badRequest().body(error("VALIDATION_ERROR","请检查必填内容和文字长度"));}
 @ExceptionHandler(OptimisticLockingFailureException.class)
 ResponseEntity<Error> conflict(Exception e){return ResponseEntity.status(409).body(error("EDIT_CONFLICT","这段回忆刚被更新，请保留输入并重新载入后合并"));}
 @ExceptionHandler(Exception.class)
 ResponseEntity<Error> other(Exception e){return ResponseEntity.status(500).body(error("INTERNAL_ERROR","暂时无法完成，请稍后重试"));}
}
